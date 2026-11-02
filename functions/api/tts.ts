interface TtsEnv {
  TTS_API_URL?: string;
  TTS_ADMIN_TOKEN?: string;
  TTS_PROVIDER?: string;
  TTS_API_TOKEN?: string;
  MICROSOFT_TTS_API_URL?: string;
}

interface PagesContext {
  request: Request;
  env: TtsEnv;
}

const DEFAULT_TTS_API = "https://xiaomi-tts.xxjss-c4.workers.dev";
const ALLOWED_ORIGINS = new Set(["https://134688.xyz", "https://www.134688.xyz"]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
    },
  });
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function extractReadableText(html: string): string {
  const match = html.match(/<article\b[^>]*id=["']article-content["'][^>]*>([\s\S]*?)<\/article>/i);
  if (!match) return "";
  return decodeEntities(
    match[1]
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<([a-z0-9]+)\b[^>]*class=["'][^"']*\bnot-prose\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|section|ul|ol|table|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function splitText(text: string, maxLen = 300): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = maxLen;
    const chunk = rest.slice(0, maxLen);
    const stop = Math.max(chunk.lastIndexOf("。"), chunk.lastIndexOf("！"), chunk.lastIndexOf("？"), chunk.lastIndexOf("\n"));
    if (stop > maxLen * 0.4) cut = stop + 1;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

async function hashSlug(slug: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(slug));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Forbidden origin" }, 403);

  const id = url.searchParams.get("id") || "";
  const text = url.searchParams.get("text") || "";
  const match = /^(post-[a-f0-9]{24})-(\d{1,3})$/.exec(id);
  if (!match || !text.trim() || text.length > 300) return json({ error: "Invalid audio request" }, 400);

  // 只允许生成本站已发布文章中真实存在的文本段，避免该接口成为任意文本合成代理。
  const slug = url.searchParams.get("slug") || "";
  if (!slug || slug.length > 180 || slug.includes("..") || /[/?#]/.test(slug)) {
    return json({ error: "Invalid article slug" }, 400);
  }
  if (match[1] !== `post-${await hashSlug(slug)}`) return json({ error: "Article ID mismatch" }, 400);

  let articleResponse: Response;
  try {
    articleResponse = await fetch(new URL(`/post/${encodeURIComponent(slug)}/`, url.origin), {
      headers: { "Accept": "text/html" },
    });
  } catch {
    return json({ error: "Unable to verify article" }, 502);
  }
  if (!articleResponse.ok) return json({ error: "Article not found" }, 404);
  const html = await articleResponse.text();
  const parts = splitText(extractReadableText(html));
  const chunkIndex = Number(match[2]);
  const normalize = (value: string) => value.replace(/\s+/g, "");
  if (!parts[chunkIndex] || normalize(parts[chunkIndex]) !== normalize(text.trim())) {
    return json({ error: "Text does not match the published article" }, 400);
  }

  const api = (env.TTS_API_URL || DEFAULT_TTS_API).replace(/\/+$/, "");

  // 切回微软时沿用原来的 Edge TTS 接口；密钥只在 Pages 服务端读取。
  if (env.TTS_PROVIDER === "microsoft") {
    const params = new URLSearchParams({ text: text.trim(), voiceName: "zh-CN-YunyangNeural", pitch: "-5%", rate: "-20%", format: "audio-24khz-96kbitrate-mono-mp3" });
    if (env.TTS_API_TOKEN) params.set("token", env.TTS_API_TOKEN);
    let microsoft: Response;
    const microsoftApi = (env.MICROSOFT_TTS_API_URL || "https://tts.134688.xyz").replace(/\/+$/, "");
    try { microsoft = await fetch(microsoftApi + "/api/synthesis?" + params); }
    catch { return json({ error: "Microsoft TTS service unavailable" }, 502); }
    if (!microsoft.ok) return json({ error: "Microsoft TTS synthesis failed", status: microsoft.status }, microsoft.status >= 500 ? 502 : microsoft.status);
    return new Response(microsoft.body, { headers: { "Content-Type": microsoft.headers.get("Content-Type") || "audio/mpeg", "Cache-Control": "no-store" } });
  }

  const token = env.TTS_ADMIN_TOKEN;
  if (!token) return json({ error: "TTS service is not configured" }, 503);
  let upstream: Response;
  try {
    upstream = await fetch(api + "/generate", { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ id, text: text.trim(), style: "像朋友面对面聊天一样自然地说普通话，生活化、放松、不端着，不要播音腔，不要刻意煽情；语速适中，停顿自然，吐字清楚。", voice: "白桦" }) });
  } catch { return json({ error: "TTS service unavailable" }, 502); }
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok) return json({ error: "TTS generation failed", status: upstream.status }, upstream.status >= 500 ? 502 : upstream.status);
  if (!body || typeof body.audio_url !== "string") return json({ error: "Invalid TTS response" }, 502);
  return json({ audio_url: body.audio_url, cached: Boolean(body.cached) });
}
