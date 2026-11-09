interface TtsEnv {
	// 小米 TTS（主力）：地址默认 ccb.xx.kg，token 为 Worker 的 ACCESS_TOKEN
	XIAOMI_API_URL?: string;
	XIAOMI_API_TOKEN?: string;
	// 微软 TTS（兜底）：沿用原有配置，一行不改
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
// 两套上游都在服务端读环境变量，令牌绝不下发前端。
//
// 合成优先级：小米（主力）→ 微软（兜底）。任一整篇失败才降级，保证一个 MP3 内音色连贯。
// 小米不传 voice，用 Worker 默认音色；微软保留原有音色与参数（降级后音色不同属正常）。

// 小米 TTS（主力，ccb.xx.kg 指向的 Worker）
const DEFAULT_XIAOMI_API = "https://ccb.xx.kg";
// 微软 TTS（兜底，原有配置完全不动）
const DEFAULT_TTS_API = "https://tts.134688.xyz";
const VOICE = "zh-CN-XiaoxiaoNeural";
const PITCH = "-10%";
const RATE = "-15%";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// 早期无 R2、点击实时合成，怕读者久等才按 300 字切；现在发文即预生成、读者零等待，
// 分段只影响上游单次请求长度，故放宽到 2000（小米 Worker 上限 8000）。
const CHUNK = 2000;
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
	// AWS SigV4 要求 YYYYMMDDTHHMMSSZ，中间的 T 必须保留，删掉会 403 RequestTimeTooSkewed
	const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
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

// 给浏览器播放用的链接
async function presignGet(env: TtsEnv, key: string): Promise<string> {
	// 若配了自定义域名（已绑定到该 R2 桶，域名根即桶根，且通常已设为公开可读），
	// 直接返回干净直链，不带桶名前缀、无需签名：CDN 可缓存、不过期、URL 简洁。
	// 注意：写入始终走私有 S3 端点 + 密钥鉴权，与此处的只读公开播放互不冲突。
	if (env.R2_PUBLIC_HOST) {
		return `https://${env.R2_PUBLIC_HOST}/${key}`;
	}
	// 未配自定义域名：走私有 S3 端点 + presigned GET（SigV4 签名鉴权，1 小时有效）
	const { amz, dat } = amzNow();
	const host = s3Host(env.R2_ACCOUNT_ID!);
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

type Provider = "xiaomi" | "microsoft";

// 小米（主力）：POST /tts，JSON body 只带 text/format，不指定音色（Worker 默认白桦）。
// 令牌只在这里的服务端请求头里出现，绝不下发浏览器。
async function synthXiaomi(env: TtsEnv, text: string): Promise<Uint8Array> {
	const api = (env.XIAOMI_API_URL || DEFAULT_XIAOMI_API).replace(/\/+$/, "");
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (env.XIAOMI_API_TOKEN) headers["Authorization"] = `Bearer ${env.XIAOMI_API_TOKEN}`;
	const res = await fetch(`${api}/tts?format=mp3`, {
		method: "POST",
		headers,
		body: JSON.stringify({ text, format: "mp3" }),
	});
	if (!res.ok) throw new Error(`Xiaomi TTS ${res.status}`);
	return stripId3(new Uint8Array(await res.arrayBuffer()));
}

// 微软（兜底）：完全沿用原有 GET /api/synthesis 与音色参数，一字未改。
async function synthMicrosoft(env: TtsEnv, text: string): Promise<Uint8Array> {
	const api = (env.TTS_API_URL || DEFAULT_TTS_API).replace(/\/+$/, "");
	const p = new URLSearchParams({ text, voiceName: VOICE, pitch: PITCH, rate: RATE, format: FORMAT });
	if (env.TTS_API_TOKEN) p.set("token", env.TTS_API_TOKEN);
	const res = await fetch(`${api}/api/synthesis?${p}`);
	if (!res.ok) throw new Error(`Microsoft TTS ${res.status}`);
	return stripId3(new Uint8Array(await res.arrayBuffer()));
}

function synthChunk(env: TtsEnv, provider: Provider, text: string): Promise<Uint8Array> {
	return provider === "xiaomi" ? synthXiaomi(env, text) : synthMicrosoft(env, text);
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

// 单个 provider 合成整篇：分段并发 → 同参数 MP3 字节拼接（无需 ffmpeg）
async function synthesizeWith(env: TtsEnv, provider: Provider, text: string): Promise<Uint8Array> {
	const chunks = splitText(text, CHUNK);
	const parts = await mapPool(chunks, CONCURRENCY, (c) => synthChunk(env, provider, c));
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
// 这样同一篇文章里不会一半男声一半女声；跨文章音色不同属正常，不追求统一。
async function synthesize(env: TtsEnv, text: string): Promise<Uint8Array> {
	try {
		return await synthesizeWith(env, "xiaomi", text);
	} catch {
		return await synthesizeWith(env, "microsoft", text);
	}
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
// 单段流式模式（无 slug / R2 异常兜底）：同样走小米优先 → 微软降级，直接把 MP3 流返回浏览器
async function streamSegment(env: TtsEnv, text: string): Promise<Response> {
	if (!text) return new Response("Missing text parameter", { status: 400 });

	// 先试小米
	const xApi = (env.XIAOMI_API_URL || DEFAULT_XIAOMI_API).replace(/\/+$/, "");
	const xHeaders: Record<string, string> = { "Content-Type": "application/json" };
	if (env.XIAOMI_API_TOKEN) xHeaders["Authorization"] = `Bearer ${env.XIAOMI_API_TOKEN}`;
	const xRes = await fetch(`${xApi}/tts?format=mp3`, {
		method: "POST",
		headers: xHeaders,
		body: JSON.stringify({ text, format: "mp3" }),
	}).catch(() => null);
	if (xRes && xRes.ok) {
		return new Response(xRes.body, {
			headers: {
				"Content-Type": xRes.headers.get("Content-Type") || "audio/mpeg",
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		});
	}

	// 小米失败：降级微软（沿用原有 GET 接口与音色参数）
	const mApi = (env.TTS_API_URL || DEFAULT_TTS_API).replace(/\/+$/, "");
	const p = new URLSearchParams({ text, voiceName: VOICE, pitch: PITCH, rate: RATE, format: FORMAT });
	if (env.TTS_API_TOKEN) p.set("token", env.TTS_API_TOKEN);
	const mRes = await fetch(`${mApi}/api/synthesis?${p}`);
	if (!mRes.ok) return new Response("TTS synthesis failed", { status: mRes.status });
	return new Response(mRes.body, {
		headers: {
			"Content-Type": mRes.headers.get("Content-Type") || "audio/mpeg",
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
