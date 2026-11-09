#!/usr/bin/env node
// 构建时预生成：把本次提交新增/改动的文章朗读音频合成并上传到 R2（私有桶）。
// 仅 Cloudflare Pages 构建环境（CF_PAGES）下运行；缺凭据时安全跳过，不影响构建。
// 旧文章（300 篇）不在这里处理，读者首次点击时由 functions/api/tts.ts 按需合成并缓存。

import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const POST_DIR = "src/content/post";
const PREFIX = "audio";

// 合成优先级：小米（主力）→ 微软（兜底），整篇为单位降级。
// 小米不传音色，用 Worker 默认；微软保留原有音色与参数（降级后音色不同属正常）。
// 令牌只放构建环境变量，服务端使用，绝不进前端。
const DEFAULT_XIAOMI_API = "https://ccb.xx.kg"; // 小米 TTS（主力）
const DEFAULT_TTS_API = "https://tts.134688.xyz"; // 微软 TTS（兜底，原有配置不动）
const VOICE = "zh-CN-XiaoxiaoNeural";
const PITCH = "-10%";
const RATE = "-15%";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// 早期无 R2、点击实时合成才按 300 字切；现在发文即预生成、读者零等待，放宽到 2000。
const CHUNK = 2000;
const REGION = "auto";
const SERVICE = "s3";
const CONCURRENCY = 5;

const env = process.env;

function log(...a) {
	console.log("[generate-tts]", ...a);
}

// 通过 GitHub API 精确查本次部署 commit 改动的文章。
// 注意：Cloudflare Pages 是浅克隆，git show HEAD 会把整个仓库当成一次提交、列出全部文章，
// 导致全量预生成（曾把 300 篇旧文全部实时合成一遍）。因此改用 CF_PAGES_COMMIT_SHA + API，
// 且检测失败时一律安全跳过（绝不回退到全量），旧文章交由运行时按需合成。
const MAX_POSTS = 10; // 单次部署最多预生成篇数，兜底防止意外全量
async function changedPosts() {
	const sha = env.CF_PAGES_COMMIT_SHA;
	if (!sha) {
		log("无 CF_PAGES_COMMIT_SHA，跳过预生成（文章走按需合成）。");
		return [];
	}
	try {
		const res = await fetch(`https://api.github.com/repos/myogg/astro/commits/${sha}`, {
			headers: { Accept: "application/vnd.github+json", "User-Agent": "astro-tts-build" },
		});
		if (!res.ok) {
			log(`GitHub API 返回 ${res.status}，跳过预生成（文章走按需合成）。`);
			return [];
		}
		const data = await res.json();
		const files = (data.files || [])
			.filter((f) => f.status === "added" || f.status === "modified")
			.map((f) => f.filename)
			.filter((f) => f.startsWith(POST_DIR + "/") && f.endsWith(".md"));
		if (files.length > MAX_POSTS) {
			log(`改动文章 ${files.length} 篇超过上限 ${MAX_POSTS}，跳过预生成（文章走按需合成）。`);
			return [];
		}
		return files;
	} catch (e) {
		log("改动检测异常，跳过预生成：", e.message);
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

// 小米（主力）：POST /tts，只带 text/format，不指定音色（Worker 默认白桦）
async function synthXiaomi(text) {
	const api = (env.XIAOMI_API_URL || DEFAULT_XIAOMI_API).replace(/\/+$/, "");
	const headers = { "Content-Type": "application/json" };
	if (env.XIAOMI_API_TOKEN) headers["Authorization"] = `Bearer ${env.XIAOMI_API_TOKEN}`;
	const res = await fetch(`${api}/tts?format=mp3`, {
		method: "POST",
		headers,
		body: JSON.stringify({ text, format: "mp3" }),
	});
	if (!res.ok) throw new Error(`Xiaomi TTS ${res.status}`);
	return stripId3(new Uint8Array(await res.arrayBuffer()));
}

// 微软（兜底）：完全沿用原有 GET /api/synthesis 与音色参数，一字未改
async function synthMicrosoft(text) {
	const api = (env.TTS_API_URL || DEFAULT_TTS_API).replace(/\/+$/, "");
	const p = new URLSearchParams({ text, voiceName: VOICE, pitch: PITCH, rate: RATE, format: FORMAT });
	if (env.TTS_API_TOKEN) p.set("token", env.TTS_API_TOKEN);
	const res = await fetch(`${api}/api/synthesis?${p}`);
	if (!res.ok) throw new Error(`Microsoft TTS ${res.status}`);
	return stripId3(new Uint8Array(await res.arrayBuffer()));
}

function synthChunk(provider, text) {
	return provider === "xiaomi" ? synthXiaomi(text) : synthMicrosoft(text);
}

// 单个 provider 合成整篇：分段并发 → 同参数 MP3 字节拼接（无需 ffmpeg）
async function synthesizeWith(provider, text) {
	const chunks = splitText(text, CHUNK);
	const parts = new Array(chunks.length);
	let i = 0;
	async function worker() {
		while (i < chunks.length) {
			const idx = i++;
			parts[idx] = await synthChunk(provider, chunks[idx]);
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

// 降级链（以整篇为单位）：小米任一段失败（非 2xx / 网络异常）→ 整篇丢弃，全部改用微软重合成。
// 前提是两个 TTS 至少有一个可用；两者皆失败时本篇不写 R2，留给读者点击时再试。
async function synthesize(text) {
	try {
		return await synthesizeWith("xiaomi", text);
	} catch (e) {
		log("小米合成失败，整篇降级微软:", e.message);
		return await synthesizeWith("microsoft", text);
	}
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
	// AWS SigV4 要求 YYYYMMDDTHHMMSSZ，中间的 T 必须保留，删掉会 403 RequestTimeTooSkewed
	const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
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
	const files = await changedPosts();
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
