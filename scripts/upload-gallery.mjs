// 画廊图片上传脚本
// 用法：
//   CFBED_API_TOKEN=xxx node scripts/upload-gallery.mjs <图片路径...> --group "2026 秋天"
//
// 做三件事：压缩成 WebP → 传到 i.134688.xyz → 把返回的链接写进 src/data/gallery.json
// 需要 sharp：pnpm add -D sharp

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const groupIdx = args.indexOf("--group");
const group = groupIdx >= 0 ? args[groupIdx + 1] : "随手拍";
if (groupIdx >= 0) args.splice(groupIdx, 2);

const TOKEN = process.env.CFBED_API_TOKEN;
const ENDPOINT = "https://i.134688.xyz/upload?returnFormat=full";
const DATA_FILE = path.resolve("src/data/gallery.json");

if (!TOKEN) {
  console.error("请先设置环境变量 CFBED_API_TOKEN（图床的 API Token）。");
  process.exit(1);
}
if (args.length === 0) {
  console.error("用法：CFBED_API_TOKEN=xxx node scripts/upload-gallery.mjs 图片1.jpg 图片2.png --group \"分组名\"");
  process.exit(1);
}

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("缺少依赖 sharp，请先运行：pnpm add -D sharp");
  process.exit(1);
}

const raw = await fs.readFile(DATA_FILE, "utf-8");
const data = JSON.parse(raw);
data.groups = Array.isArray(data.groups) ? data.groups : [];
let target = data.groups.find((g) => g.name === group);
if (!target) {
  target = { name: group, date: new Date().toISOString().slice(0, 7), photos: [] };
  data.groups.unshift(target);
}
target.photos = Array.isArray(target.photos) ? target.photos : [];

for (const file of args) {
  const abs = path.resolve(file);
  const buf = await fs.readFile(abs);
  const webp = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  const name = path.basename(abs, path.extname(abs)) + ".webp";

  const form = new FormData();
  form.append("file", new Blob([webp], { type: "image/webp" }), name);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN },
    body: form,
  });
  const result = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`✗ ${file} 上传失败（HTTP ${res.status}）：`, JSON.stringify(result));
    continue;
  }
  const item = Array.isArray(result) ? result[0] : result?.result || result;
  const url = item?.publicUrl || item?.src || item?.url;
  if (typeof url !== "string" || !url) {
    console.error(`✗ ${file} 图床未返回可用地址：`, JSON.stringify(result));
    continue;
  }
  target.photos.push({ url, caption: path.basename(abs, path.extname(abs)) });
  console.log(`✓ ${file} -> ${url}`);
}

await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
console.log(`\n已更新 ${DATA_FILE}，分组「${group}」现有 ${target.photos.length} 张。提交推送即可上线。`);
