interface TtsEnv {
	// 微软 Edge TTS 代理（tts.134688.xyz）的上游地址与令牌，仅存在于服务端环境变量
	TTS_API_URL?: string;
	TTS_API_TOKEN?: string;
}

interface PagesContext {
	request: Request;
	env: TtsEnv;
}

// 朗读走同源代理，令牌不下发浏览器。
// 纯微软 Edge TTS：服务端按 300 字分段并发合成，同参数 MP3 字节拼接成一个音频流返回。
// 不写 R2、不做缓存、不调用小米，没有任何持久化副作用。
const DEFAULT_TTS_API = "https://tts.134688.xyz";
const VOICE = "zh-CN-XiaoxiaoNeural";
const PITCH = "-10%";
const RATE = "-15%";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// 无 R2 缓存、点击时实时合成，拆小段并发合成可缩短读者等待
const CHUNK = 300;
const CONCURRENCY = 5;

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
	if (!res.ok) throw new Error(`Microsoft TTS ${res.status}`);
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

async function streamAudio(env: TtsEnv, text: string): Promise<Response> {
	if (!text || !text.trim()) return new Response("Missing text parameter", { status: 400 });
	let mp3: Uint8Array;
	try {
		mp3 = await synthesize(env, text);
	} catch {
		return new Response("TTS synthesis failed", { status: 502 });
	}
	return new Response(mp3.buffer as ArrayBuffer, {
		headers: {
			"Content-Type": "audio/mpeg",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}

// GET：旧接口 / 单段流式（query 里带 text）
export async function onRequestGet(context: PagesContext): Promise<Response> {
	const text = new URL(context.request.url).searchParams.get("text") || "";
	return streamAudio(context.env, text);
}

// POST：当前前端使用（body 为 { slug, id, text }），整篇文本放 body 避免 URL 超长
export async function onRequestPost(context: PagesContext): Promise<Response> {
	let text = "";
	try {
		const body = (await context.request.json()) as { text?: string };
		text = body.text || "";
	} catch {
		return new Response("Invalid JSON body", { status: 400 });
	}
	return streamAudio(context.env, text);
}
