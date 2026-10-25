import { defineCollection, z } from "astro:content";

/**
 * 文章 frontmatter 契约（对齐 astro-t9tio 的写法）：
 *
 *   ---
 *   title: "标题"                    # 必填
 *   date: 2026-04-10 08:08           # 必填，也接受 2026-04-10 或 Hugo 风格的 pubDate
 *   description: "摘要"              # 可选
 *   author: "作者"                   # 可选
 *   tags: ["AI", "blog"]             # 可选，支持多行数组写法
 *   ---
 *
 * 日期用 z.coerce.date() 兜住 `2026-04-10` 与 `2026-04-10 08:08` 两种写法，
 * 展示层统一用 src/utils/date.ts 的 formatDisplayDate 转成 "Apr 10, 2026"。
 */
const postCollection = defineCollection({
	type: "content",
	schema: z
		.object({
			title: z.string(),
			description: z.string().optional(),
			image: z.string().optional(),
			date: z.coerce.date().optional(),
			// 兼容 Hugo 主题常见的 pubDate 写法，最终归一化到 date
			pubDate: z.coerce.date().optional(),
			author: z.string().optional(),
			tags: z.array(z.string()).default([]),
			categories: z.array(z.string()).default([]),
			/** GitHub Issue 编号，用于渲染评论区 */
			issue: z.number().optional(),
			/** 置为 true 则不参与构建与列表 */
			draft: z.boolean().default(false),
		})
		.refine((data) => data.date ?? data.pubDate, {
			message: "frontmatter 必须包含合法的 `date`（或 `pubDate`）",
			path: ["date"],
		})
		.transform((data) => ({
			...data,
			date: data.date ?? data.pubDate,
		})),
});

export const collections = {
	post: postCollection,
};
