import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

const token = process.env.TTS_ADMIN_TOKEN;
const api = (process.env.TTS_API_URL || "https://xiaomi-tts.xxjss-c4e.workers.dev").replace(/\/+$/, "");
const style = "像朋友面对面聊天一样自然地说普通话，生活化、放松、不端着，不要播音腔，不要刻意煽情；语速适中，停顿自然，吐字清楚。";

if (!token) {
  console.log("TTS_ADMIN_TOKEN 未配置，跳过自动预生成。");
  process.exit(0);
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function extractReadableText(html) {
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

function splitText(text, maxLen = 300) {
  const parts = [];
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

async function generate(id, text) {
  const response = await fetch(`${api}/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, text, style, voice: "白桦" }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.audio_url) {
    throw new Error(`合成失败（${id}）：HTTP ${response.status} ${body?.error || body?.details || ""}`);
  }
  console.log(`${body.cached ? "缓存" : "已生成"}：${id}`);
}

const changed = execFileSync("git", ["diff", "--name-only", "--", "src/content/post"], { encoding: "utf8" })
  .split("\n")
  .filter((path) => path.endsWith(".md"));

if (!changed.length) {
  console.log("没有变更的文章，跳过语音预生成。");
  process.exit(0);
}

for (const file of changed) {
  const slug = basename(file, ".md");
  const htmlPath = join("dist", "post", slug, "index.html");
  let html;
  try {
    html = await readFile(htmlPath, "utf8");
  } catch {
    console.log(`跳过未生成页面的文章：${slug}`);
    continue;
  }
  const text = extractReadableText(html);
  if (!text) {
    console.log(`跳过没有可朗读正文的文章：${slug}`);
    continue;
  }
  const slugHash = createHash("sha256").update(slug).digest("hex").slice(0, 24);
  const chunks = splitText(text);
  console.log(`文章 ${slug}：${chunks.length} 段`);
  for (let i = 0; i < chunks.length; i++) {
    await generate(`post-${slugHash}-${i}`, chunks[i]);
  }
}
