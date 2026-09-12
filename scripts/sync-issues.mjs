#!/usr/bin/env node
/**
 * 把 GitHub Issues 同步成 src/content/post/*.md
 *
 * 规则：
 * - 只处理仓库所有者（或 ALLOWED_AUTHORS）创建的 Issue，PR 一律跳过
 * - open = 已发布，closed = 撤稿（对应的 md 文件会被删除）
 * - 带 draft / 草稿 标签的 Issue 视为草稿，不生成文件
 * - labels 转成 tags，created_at 转成 dateFormatted
 * - 正文末尾的 #话题标签 会被抽走并合并进 tags
 * - Issue 的评论会写进 src/data/comments.json，文章页按纯文本渲染
 * - Issue 正文顶部可用 HTML 注释覆盖元数据：
 *     <!--
 *     slug: my-custom-slug
 *     description: 自定义摘要
 *     date: Apr 10, 2026
 *     -->
 *
 * 生成的文件由 scripts/issues-manifest.json 记账，手写的 md 不会被碰。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const POST_DIR = path.join(ROOT, "src", "content", "post");
const COMMENTS_FILE = path.join(ROOT, "src", "data", "comments.json");
const MANIFEST = path.join(ROOT, "scripts", "issues-manifest.json");

const REPO = process.env.GITHUB_REPOSITORY || "myogg/astro";
const [OWNER, NAME] = REPO.split("/");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const ALLOWED = (process.env.ALLOWED_AUTHORS || OWNER)
	.split(",")
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

const DRAFT_LABELS = new Set(["draft", "草稿", "wip"]);
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function apiHeaders() {
	const headers = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "astro-issue-sync",
	};
	if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
	return headers;
}

/** 按页取完某个列表接口 */
async function fetchPaged(pathAndQuery, maxPages = 20) {
	const headers = apiHeaders();
	const items = [];
	for (let page = 1; page <= maxPages; page++) {
		const sep = pathAndQuery.includes("?") ? "&" : "?";
		const url = `https://api.github.com/repos/${OWNER}/${NAME}${pathAndQuery}${sep}per_page=100&page=${page}`;
		const res = await fetch(url, { headers });
		if (!res.ok) {
			throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
		}
		const batch = await res.json();
		items.push(...batch);
		if (batch.length < 100) break;
	}
	return items;
}

function fetchAllIssues() {
	return fetchPaged("/issues?state=all");
}

/**
 * 取某个 Issue 的评论。
 * 评论是陌生人能写的内容，这里只留纯文本字段，
 * 渲染侧用 Astro 的 {} 表达式转义，绝不拼进 Markdown。
 */
async function fetchComments(issue) {
	if (!issue.comments) return [];
	const raw = await fetchPaged(`/issues/${issue.number}/comments`);
	return raw
		.filter((c) => c.user && c.user.type !== "Bot")
		.map((c) => ({
			id: c.id,
			author: c.user.login,
			authorUrl: c.user.html_url,
			avatar: `${c.user.avatar_url}${c.user.avatar_url.includes("?") ? "&" : "?"}s=64`,
			date: fileDate(c.created_at),
			url: c.html_url,
			body: (c.body || "").replace(/\r\n/g, "\n").trim(),
		}))
		.filter((c) => c.body);
}


/** 北京时间的 "Apr 10, 2026" */
function formatDate(iso) {
	const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** 北京时间的 "2026-04-10" */
function fileDate(iso) {
	const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

function slugify(text) {
	return text
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(/[^\p{Script=Han}\p{L}\p{N}-]/gu, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
}

/** 抽取正文顶部的 <!-- key: value --> 元数据块 */
function extractMeta(body) {
	const meta = {};
	const rest = body.replace(/^\s*<!--([\s\S]*?)-->\s*/, (_m, inner) => {
		let matched = false;
		for (const line of inner.split(/\r?\n/)) {
			const kv = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/);
			if (kv) {
				meta[kv[1].toLowerCase()] = kv[2];
				matched = true;
			}
		}
		return matched ? "" : _m;
	});
	return { meta, body: rest };
}

function yamlString(value) {
	return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 正文首段，用作 description 兜底 */
function firstParagraph(body) {
	for (const block of body.split(/\r?\n\s*\r?\n/)) {
		const text = block
			.replace(/^\s*[>#\-*+]+\s*/gm, "")
			.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/<[^>]+>/g, "")
			.replace(/[`*_]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (text) return text.length > 100 ? `${text.slice(0, 100)}…` : text;
	}
	return "";
}

/**
 * 抽走正文末尾的 #话题标签，转成 tags。
 * 只认文末连续的一串，且 # 前面必须是行首、空白或中文标点，
 * 这样 URL 里的 `#anchor`、代码里的 `C#编程` 都不会被误伤。
 * 纯数字的 #123 视为 Issue 引用，不当标签。
 */
function extractTrailingHashtags(body) {
	const TAG = "#[\\p{Script=Han}\\p{L}_][\\p{Script=Han}\\p{L}\\p{N}_]*";
	const match = body.match(new RegExp(`(^|[\\s。，、！？；：）)\\]】」』…—])((?:${TAG}\\s*)+)$`, "u"));
	if (!match) return { body, hashtags: [] };

	const kept = body.slice(0, match.index + match[1].length).trimEnd();
	if (!kept) return { body, hashtags: [] }; // 全文只有标签，不动

	const hashtags = match[2].match(new RegExp(TAG, "gu")).map((t) => t.slice(1));
	return { body: kept, hashtags };
}

function buildPost(issue) {
	const { meta, body } = extractMeta((issue.body || "").replace(/\r\n/g, "\n"));

	// 布局层已经渲染 h1，正文里的一级标题要去掉
	const stripped = body.replace(/^\s*#\s+.*\r?\n+/, "").trim();
	const { body: content, hashtags } = extractTrailingHashtags(stripped);

	const labelTags = issue.labels
		.map((l) => (typeof l === "string" ? l : l.name))
		.filter((n) => n && !DRAFT_LABELS.has(n.toLowerCase()));

	const tags = [];
	const seen = new Set();
	for (const tag of [...labelTags, ...hashtags]) {
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
	}

	const frontmatter = [
		"---",
		`title: ${yamlString(issue.title)}`,
		`description: ${yamlString(
			meta.description || firstParagraph(content) || issue.title,
		)}`,
		`dateFormatted: ${yamlString(meta.date || formatDate(issue.created_at))}`,
		`tags: [${tags.map(yamlString).join(", ")}]`,
		`issue: ${issue.number}`,
		"---",
	].join("\n");

	const slug = slugify(meta.slug || issue.title) || `issue-${issue.number}`;
	const file = `${fileDate(
		meta.date ? new Date(meta.date).toISOString() : issue.created_at,
	)}-${slug}.md`;

	return { file, text: `${frontmatter}\n\n${content}\n` };
}

function isPublishable(issue) {
	if (issue.pull_request) return false;
	if (issue.state !== "open") return false;
	if (!ALLOWED.includes((issue.user?.login || "").toLowerCase())) return false;
	const labels = issue.labels.map((l) =>
		(typeof l === "string" ? l : l.name).toLowerCase(),
	);
	return !labels.some((l) => DRAFT_LABELS.has(l));
}

async function main() {
	if (!TOKEN) {
		console.warn("⚠ 未设置 GITHUB_TOKEN，走匿名请求（60 次/小时限流）");
	}

	const issues = await fetchAllIssues();
	const manifest = fs.existsSync(MANIFEST)
		? JSON.parse(fs.readFileSync(MANIFEST, "utf-8"))
		: {};
	const next = {};
	const comments = {};
	let created = 0;
	let updated = 0;
	let removed = 0;
	let commentCount = 0;

	fs.mkdirSync(POST_DIR, { recursive: true });
	fs.mkdirSync(path.dirname(COMMENTS_FILE), { recursive: true });

	for (const issue of issues) {
		if (issue.pull_request) continue;

		const key = String(issue.number);
		const previous = manifest[key];

		if (!isPublishable(issue)) {
			if (previous) {
				const stale = path.join(POST_DIR, previous.file);
				if (fs.existsSync(stale)) {
					fs.unlinkSync(stale);
					removed++;
					console.log(`- 删除 #${issue.number} ${previous.file}`);
				}
			}
			continue;
		}

		const { file, text } = buildPost(issue);
		const target = path.join(POST_DIR, file);

		// 标题/日期改了导致文件名变化，先清掉旧文件
		if (previous && previous.file !== file) {
			const stale = path.join(POST_DIR, previous.file);
			if (fs.existsSync(stale)) fs.unlinkSync(stale);
			console.log(`~ 重命名 #${issue.number} ${previous.file} → ${file}`);
		}

		const existed = fs.existsSync(target);
		if (!existed || fs.readFileSync(target, "utf-8") !== text) {
			fs.writeFileSync(target, text, "utf-8");
			if (existed) {
				updated++;
				console.log(`* 更新 #${issue.number} ${file}`);
			} else {
				created++;
				console.log(`+ 新增 #${issue.number} ${file}`);
			}
		}

		next[key] = { file, updatedAt: issue.updated_at };

		const thread = await fetchComments(issue);
		if (thread.length) {
			comments[key] = thread;
			commentCount += thread.length;
		}
	}

	// Issue 被物理删除后，记账里的残留文件也要清掉
	for (const [key, entry] of Object.entries(manifest)) {
		if (next[key]) continue;
		if (issues.some((i) => String(i.number) === key)) continue;
		const stale = path.join(POST_DIR, entry.file);
		if (fs.existsSync(stale)) {
			fs.unlinkSync(stale);
			removed++;
			console.log(`- 删除已消失的 #${key} ${entry.file}`);
		}
	}

	fs.writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	fs.writeFileSync(
		COMMENTS_FILE,
		`${JSON.stringify(comments, null, 2)}\n`,
		"utf-8",
	);
	console.log(
		`\n完成：新增 ${created}，更新 ${updated}，删除 ${removed}，共记账 ${
			Object.keys(next).length
		} 篇，评论 ${commentCount} 条`,
	);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
