interface TtsEnv {
	TTS_API?: string;
	TTS_TOKEN?: string;
}

interface PagesContext {
	request: Request;
	env: TtsEnv;
}

// 站点是纯静态的，token 不能跟着页面发到浏览器，所以朗读改走这个同源代理。
// 上游地址与 token 放在 Cloudflare Pages 的环境变量里（TTS_API / TTS_TOKEN）。
const DEFAULT_TTS_API = "https://tts.134688.xyz";

export async function onRequestGet(context: PagesContext): Promise<Response> {
	const { request, env } = context;
	const url = new URL(request.url);

	const text = url.searchParams.get("text");
	const voiceName = url.searchParams.get("voiceName") || "zh-CN-XiaoxiaoNeural";

	if (!text) {
		return new Response("Missing text parameter", { status: 400 });
	}

	const api = (env.TTS_API || DEFAULT_TTS_API).replace(/\/+$/, "");
	const params = new URLSearchParams({ text, voiceName });

	if (env.TTS_TOKEN) {
		params.set("token", env.TTS_TOKEN);
	}

	const res = await fetch(`${api}/api/synthesis?${params}`);

	if (!res.ok) {
		return new Response("TTS synthesis failed", { status: res.status });
	}

	return new Response(res.body, {
		headers: {
			"Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}
