interface TtsEnv {
	TTS_API_URL?: string;
	TTS_API_TOKEN?: string;
	// 跨账号私有 R2 桶（账号 B），通过 S3 兼容 API + SigV4 签名读写
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_ACCOUNT_ID?: string;
	R2_BUCKET?: string;
	// 播放用的公开域名（私有桶 + presigned 链接），缺省回退到 S3 端点
	R2_PUBLIC_HOST?: string;
}

interface PagesContext {
	request: Request;
	env: TtsEnv;
}

// 站点是纯静态的，token 不能跟着页面发到浏览器，所以朗读改走这个同源代理。
// 上游地址与 token 放在 Cloudflare Pages 的环境变量里（TTS_API_URL / TTS_API_TOKEN）。
const DEFAULT_TTS_API = "https://tts.134688.xyz";
const VOICE = "zh-CN-XiaoxiaoNeural";
const PITCH = "-10%";
const RATE = "-15%";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const CHUNK = 300; // 单段合成字数上限
const PREFIX = "audio"; // R2 键前缀
const REGION = "auto";
const SERVICE = "s3";
const PRESIGN_TTL = 3600; // presigned 播放链接有效期（秒）
const CONCURRENCY = 5; // 分段合成并发数

// ---------- 加密原语（Web Crypto） ----------
const enc = new TextEncoder();
function hex(b: Uint8Array): string {
	return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function sha256(buf: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
	const data = typeof buf === "string" ? enc.encode(buf) : buf;
	return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}
async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<Uint8Array> {
	const ck = await crypto.subtle.importKey(
		"raw",
		key as BufferSource,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", ck, enc.encode(msg)));
}
async function deriveSigningKey(
	secret: string,
	dat: string,
	region: string,
	service: string,
): Promise<Uint8Array> {
	let k = await hmac(enc.encode("AWS4" + secret), dat);
	k = await hmac(k, region);
	k = await hmac(k, service);
	k = await hmac(k, "aws4_request");
	return k;
}
function amzNow(d = new Date()): { amz: string; dat: string } {
	const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, "").replace("T", "");
	return { amz, dat: amz.slice(0, 8) };
}
function s3Host(account: string): string {
	return `${account}.r2.cloudflarestorage.com`;
}

// 给存储操作（PUT/HEAD/GET，走 S3 端点）生成 Authorization 头
async function authHeader(
	env: TtsEnv,
	method: string,
	key: string,
	payloadHash: string,
	extra: Record<string, string> = {},
): Promise<Record<string, string>> {
	const { amz, dat } = amzNow();
	const host = s3Host(env.R2_ACCOUNT_ID!);
	const headers: Record<string, string> = {
		host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": amz,
		...extra,
	};
	const sortedKeys = Object.keys(headers).sort();
	const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("");
	const signedHeaders = sortedKeys.join(";");
	const canonicalRequest = `${method}\n/${env.R2_BUCKET}/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
	const scope = `${dat}/${REGION}/${SERVICE}/aws4_request`;
	const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hex(await sha256(canonicalRequest))}`;
	const kSign = await deriveSigningKey(env.R2_SECRET_ACCESS_KEY!, dat, REGION, SERVICE);
	const sig = hex(await hmac(kSign, stringToSign));
	return {
		...headers,
		Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
	};
}

// 给浏览器播放用的 presigned GET 链接（host = 公开域名或 S3 端点）
async function presignGet(env: TtsEnv, key: string): Promise<string> {
	const { amz, dat } = amzNow();
	const host = env.R2_PUBLIC_HOST || s3Host(env.R2_ACCOUNT_ID!);
	const cred = `${env.R2_ACCESS_KEY_ID}/${dat}/${REGION}/${SERVICE}/aws4_request`;
	const params: Record<string, string> = {
		"X-Amz-Algorithm": "AWS4-HMAC-SHA256",
		"X-Amz-Credential": cred,
		"X-Amz-Date": amz,
		"X-Amz-Expires": String(PRESIGN_TTL),
		"X-Amz-SignedHeaders": "host",
	};
	const qkeys = Object.keys(params).sort();
	const canonicalQuery = qkeys.map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
	const canonicalHeaders = `host:${host}\n`;
	const payloadHash = "UNSIGNED-PAYLOAD";
	const canonicalRequest = `GET\n/${env.R2_BUCKET}/${key}\n${canonicalQuery}\n${canonicalHeaders}\nhost\n${payloadHash}`;
	const scope = `${dat}/${REGION}/${SERVICE}/aws4_request`;
	const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hex(await sha256(canonicalRequest))}`;
	const kSign = await deriveSigningKey(env.R2_SECRET_ACCESS_KEY!, dat, REGION, SERVICE);
	const sig = hex(await hmac(kSign, stringToSign));
	const finalQuery = `${canonicalQuery}&X-Amz-Signature=${sig}`;
	return `https://${host}/${env.R2_BUCKET}/${key}?${finalQuery}`;
}

// ---------- 文本与合成 ----------
function splitText(text: string, maxLen: number): string[] {
	const parts: string[] = [];
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

// 去掉可能附带的 ID3v2 头，便于同参数 MP3 直接字节拼接
function stripId3(buf: Uint8Array): Uint8Array {
	if (buf.length > 9 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
		const size =
			((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
		return buf.subarray(10 + size);
	}
	return buf;
}

async function synthChunk(env: TtsEnv, text: string): Promise<Uint8Array> {
	const api = (env.TTS_API_URL || DEFAULT_TTS_API).replace(/\/+$/, "");
	const p = new URLSearchParams({ text, voiceName: VOICE, pitch: PITCH, rate: RATE, format: FORMAT });
	if (env.TTS_API_TOKEN) p.set("token", env.TTS_API_TOKEN);
	const res = await fetch(`${api}/api/synthesis?${p}`);
	if (!res.ok) throw new Error(`TTS ${res.status}`);
	return stripId3(new Uint8Array(await res.arrayBuffer()));
}

// 并发受限的 map
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let i = 0;
	async function worker() {
		while (i < items.length) {
			const idx = i++;
			out[idx] = await fn(items[idx]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

// 分段合成 → 同参数 MP3 字节拼接（无需 ffmpeg）
async function synthesize(env: TtsEnv, text: string): Promise<Uint8Array> {
	const chunks = splitText(text, CHUNK);
	const parts = await mapPool(chunks, CONCURRENCY, (c) => synthChunk(env, c));
	const total = parts.reduce((n, b) => n + b.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const b of parts) {
		out.set(b, o);
		o += b.length;
	}
	return out;
}

async function r2Exists(env: TtsEnv, key: string): Promise<boolean> {
	const headers = await authHeader(env, "HEAD", key, "UNSIGNED-PAYLOAD");
	const res = await fetch(`https://${s3Host(env.R2_ACCOUNT_ID!)}/${env.R2_BUCKET}/${key}`, {
		method: "HEAD",
		headers,
	});
	return res.status === 200;
}

async function r2Put(env: TtsEnv, key: string, body: Uint8Array): Promise<void> {
	const ph = hex(await sha256(body));
	const headers = await authHeader(env, "PUT", key, ph, { "content-type": "audio/mpeg" });
	const res = await fetch(`https://${s3Host(env.R2_ACCOUNT_ID!)}/${env.R2_BUCKET}/${key}`, {
		method: "PUT",
		headers: { ...headers, "content-length": String(body.length) },
		body,
	});
	if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${await res.text()}`);
}

// ---------- 响应 ----------
// 单段流式模式（无 slug）：直接把上游 MP3 流返回给浏览器
async function streamSegment(env: TtsEnv, text: string): Promise<Response> {
	if (!text) return new Response("Missing text parameter", { status: 400 });
	const api = (env.TTS_API_URL || DEFAULT_TTS_API).replace(/\/+$/, "");
	const p = new URLSearchParams({ text, voiceName: VOICE, pitch: PITCH, rate: RATE, format: FORMAT });
	if (env.TTS_API_TOKEN) p.set("token", env.TTS_API_TOKEN);
	const res = await fetch(`${api}/api/synthesis?${p}`);
	if (!res.ok) return new Response("TTS synthesis failed", { status: res.status });
	return new Response(res.body, {
		headers: {
			"Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

// 整篇模式：查 R2 → 未命中则分段合成合并 → 存 R2 → 返回 presigned 播放链接
async function handleSlug(env: TtsEnv, slug: string, text: string): Promise<Response> {
	if (!text) return new Response("Missing text parameter", { status: 400 });

	const hasR2 = env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID && env.R2_BUCKET;
	const key = `${PREFIX}/${slug}.mp3`;

	if (!hasR2) {
		// 没配 R2：回退为单段流式（前端会按 audio/* 处理）
		return streamSegment(env, text);
	}

	try {
		if (await r2Exists(env, key)) {
			return json({ audio_url: await presignGet(env, key), cached: true });
		}
		const mp3 = await synthesize(env, text);
		await r2Put(env, key, mp3);
		return json({ audio_url: await presignGet(env, key), cached: false });
	} catch {
		// R2 异常时降级为流式，保证可听
		return streamSegment(env, text);
	}
}

// 单段流式（无 slug）：直接把上游 MP3 流返回（保留旧接口 / 兜底）
export async function onRequestGet(context: PagesContext): Promise<Response> {
	const { request, env } = context;
	const url = new URL(request.url);
	const text = url.searchParams.get("text");
	return streamSegment(env, text || "");
}

// 整篇模式走 POST，正文放 body，避免长文 URL 超过 8KB 上限
export async function onRequestPost(context: PagesContext): Promise<Response> {
	const { request, env } = context;
	let slug = "";
	let text = "";
	try {
		const body = (await request.json()) as { slug?: string; id?: string; text?: string };
		slug = body.slug || "";
		text = body.text || "";
	} catch {
		return new Response("Invalid JSON body", { status: 400 });
	}
	if (!slug) return new Response("Missing slug", { status: 400 });
	return handleSlug(env, slug, text);
}
