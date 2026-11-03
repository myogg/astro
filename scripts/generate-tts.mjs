#!/usr/bin/env node
// 构建时预生成：把本次提交新增/改动的文章朗读音频合成并上传到 R2（私有桶）。
// 仅 Cloudflare Pages 构建环境（CF_PAGES）下运行；缺凭据时安全跳过，不影响构建。
// 旧文章（300 篇）不在这里处理，读者首次点击时由 functions/api/tts.ts 按需合成并缓存。

import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const POST_DIR = "src/content/post";
const PREFIX = "audio";
const VOICE = "zh-CN-XiaoxiaoNeural";
const PITCH = "-10%";
const RATE = "-15%";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const CHUNK = 300;
const REGION = "auto";
const SERVICE = "s3";
const CONCURRENCY = 5;

const env = process.env;

function log(...a) {
	console.log("[generate-tts]", ...a);
}

function changedPosts() {
	try {
		// 本次提交改动的文件（浅克隆也能用），筛出 post 目录里的 .md
		const out = execSync("git show --name-only --pretty=format: HEAD", { encoding: "utf-8" });
		return out
			.split("\n")
			.map((x) => x.trim())
			.filter((x) => x.startsWith(POST_DIR + "/") && x.endsWith(".md"));
	} catch (e) {
		log("无法检测改动文件，跳过预生成：", e.message);
		return [];
	}
}

// 文件名去扩展名即 Astro 默认 slug（与前端 entry.slug 对齐）
function slugOf(path) {
	return path.split("/").pop().replace(/\.md$/, "");
}

// 极简 Markdown -> 纯文本（够 TTS 用；与前端 readableText 不同源，但都只读正文）
function mdToText(md) {
	let s = md.replace(/^---[\s\S]*?---/, ""); // 去 frontmatter
	s = s.replace(/```[\s\S]*?```/g, " "); // 代码块
	s = s.replace(/`[^`]*`/g, " ");
	s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // 图片
	s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // 链接保留文字
	s = s.replace(/^#{1,6}\s+/gm, ""); // 标题符号
	s = s.replace(/[*_~]+/g, ""); // 强调符号
	s = s.replace(/<[^>]+>/g, " "); // HTML 标签
	s = s.replace(/^\s*[-*+>]\s+/gm, ""); // 列表/引用
	s = s.replace(/\s+/g, " ").trim();
	return s;
}

function splitText(text, maxLen) {
	const parts = [];
	let rest = text;
	while (rest.length > maxLen) {
		const chunk = rest.slice(0, maxLen);
		const stop = Math.max(
			chunk.lastIndexOf("。"),
			chunk.lastIndexOf("！"),
			chunk.lastIndexOf("？"),
			chunk.lastIndexOf("\n"),
		);
		const cut = stop > maxLen * 0.4 ? stop + 1 : maxLen;
		parts.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest.trim()) parts.push(rest.trim());
	return parts;
}

function stripId3(buf) {
	if (buf.length > 9 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
		const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
		return buf.subarray(10 + size);
	}
	return buf;
}

async function synthChunk(text) {
	const api = (env.TTS_API_URL || "https://tts.134688.xyz").replace(/\/+$/, "");
	const p = new URLSearchParams({ text, voiceName: VOICE, pitch: PITCH, rate: RATE, format: FORMAT });
	if (env.TTS_API_TOKEN) p.set("token", env.TTS_API_TOKEN);
	const res = await fetch(`${api}/api/synthesis?${p}`);
	if (!res.ok) throw new Error(`TTS ${res.status}`);
	return stripId3(new Uint8Array(await res.arrayBuffer()));
}

async function synthesize(text) {
	const chunks = splitText(text, CHUNK);
	const parts = new Array(chunks.length);
	let i = 0;
	async function worker() {
		while (i < chunks.length) {
			const idx = i++;
			parts[idx] = await synthChunk(chunks[idx]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
	const total = parts.reduce((n, b) => n + b.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const b of parts) {
		out.set(b, o);
		o += b.length;
	}
	return out;
}

// ---------- S3 SigV4（PUT 到账号 B 的私有桶） ----------
function hmac(key, msg) {
	return crypto.createHmac("sha256", key).update(msg).digest();
}
function hex(b) {
	return b.toString("hex");
}
async function putR2(key, body) {
	const account = env.R2_ACCOUNT_ID;
	const bucket = env.R2_BUCKET;
	const host = `${account}.r2.cloudflarestorage.com`;
	const now = new Date();
	const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, "").replace("T", "");
	const dat = amz.slice(0, 8);
	const ph = hex(crypto.createHash("sha256").update(body).digest());
	// content-length 不进签名集合（运行时自动补），与已验证实现一致
	const headers = {
		host,
		"x-amz-content-sha256": ph,
		"x-amz-date": amz,
		"content-type": "audio/mpeg",
	};
	const sortedKeys = Object.keys(headers).sort();
	const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("");
	const signedHeaders = sortedKeys.join(";");
	const canonicalRequest = `PUT\n/${bucket}/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${ph}`;
	const scope = `${dat}/${REGION}/${SERVICE}/aws4_request`;
	const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hex(crypto.createHash("sha256").update(canonicalRequest).digest())}`;
	let k = hmac("AWS4" + env.R2_SECRET_ACCESS_KEY, dat);
	k = hmac(k, REGION);
	k = hmac(k, SERVICE);
	k = hmac(k, "aws4_request");
	const sig = hex(hmac(k, stringToSign));
	const auth = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
	const res = await fetch(`https://${host}/${bucket}/${key}`, {
		method: "PUT",
		headers: { ...headers, Authorization: auth },
		body,
	});
	if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${await res.text()}`);
}

async function main() {
	if (!env.CF_PAGES) {
		log("非 Cloudflare Pages 构建环境，跳过。");
		return;
	}
	const need = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID", "R2_BUCKET"];
	if (!need.every((k) => env[k])) {
		log("缺少 R2 凭据（" + need.join(", ") + "），跳过预生成，文章将走按需合成。");
		return;
	}
	if (!existsSync(POST_DIR)) {
		log("未找到", POST_DIR, "，跳过。");
		return;
	}
	const files = changedPosts();
	if (!files.length) {
		log("本次提交无文章改动，跳过。");
		return;
	}
	log(`检测到 ${files.length} 篇改动文章，开始预生成音频…`);
	for (const f of files) {
		try {
			const slug = slugOf(f);
			const text = mdToText(readFileSync(f, "utf-8"));
			if (!text) {
				log("跳过（无正文）:", slug);
				continue;
			}
			const mp3 = await synthesize(text);
			const key = `${PREFIX}/${slug}.mp3`;
			await putR2(key, mp3);
			log(`已生成 ${key} (${(mp3.length / 1024).toFixed(1)} KB)`);
		} catch (e) {
			log("生成失败，继续下一篇:", f, "->", e.message);
		}
	}
	log("预生成结束。");
}

main().catch((e) => {
	log("异常退出:", e.message);
	process.exit(0); // 预生成失败不应阻断构建
});
