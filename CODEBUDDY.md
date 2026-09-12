# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Commands

```bash
pnpm dev          # 开发服务器（= pnpm start）
pnpm build        # astro check → astro build
pnpm preview      # 预览 dist/
pnpm sync         # 本地跑一次 Issues → Markdown 同步
pnpm check        # biome check --apply-unsafe .（见下方警告）
```

- 包管理器是 **pnpm 9.12.2**（`packageManager` 已声明），别用 npm/yarn。
- **没有测试套件**，也没有单测命令。验证手段就是 `pnpm build`（内含 `astro check`）+ 人工预览。
- **慎用 `pnpm check`**：`--apply-unsafe` 会重排全仓库（曾一次改动 38 个无关文件）。只想格式化自己改的文件时跑 `pnpm biome check --apply <file>`，别全仓库跑。
- 站点 URL `https://134688.xyz`（`astro.config.mjs` 的 `site`），RSS 和 canonical 绝对地址依赖它。
- `dist/` 是构建产物，不要直接编辑；`tsconfig.json` 已排除它。

## 架构

Astro 4 纯静态站点（个人博客「北方的博客」），无 SSR/hybrid adapter，全部页面构建期预渲染。部署在 Cloudflare Pages，**监听 GitHub push 自动构建**。

### 两套并存的正文来源

这是本仓库最容易踩的一点：`src/content/post/*.md` 里的文章有两种来源。

1. **GitHub Issues（新文章）** — 由机器人同步生成，frontmatter 带 `issue: <number>`
2. **手写 Markdown（历史文章）** — 没有 `issue` 字段

区分方式就是看 `issue` 字段。评论区只在有该字段时渲染。

**改动 Issue 来源的文章时要注意**：直接编辑 `.md` 会在下次同步时被 Issue 内容覆盖。正文的真实源头是 Issue，要改内容就去改 Issue，或者改生成逻辑。

### Issues → Markdown 同步管线

```
开 Issue / 改 Issue / 评论
  → .github/workflows/sync-issues.yml (issues, issue_comment, workflow_dispatch)
  → node scripts/sync-issues.mjs
  → 写 src/content/post/*.md + src/data/comments.json + scripts/issues-manifest.json
  → 机器人身份 commit & push
  → Cloudflare Pages 构建上线
```

`scripts/sync-issues.mjs` 的行为契约：

- **发布条件**：仓库所有者（或 `ALLOWED_AUTHORS`）创建的 **open** Issue 全部算文章，不需要特殊标签。PR 一律跳过。带 `draft` / `草稿` / `wip` label 的跳过（撤稿 = 关闭 Issue 或加草稿标签）。
- **tags 来源**：Issue labels + 正文末尾的 `#话题标签`，合并去重。`extractTrailingHashtags` 用 `\p{Script=Han}` 系 Unicode 正则，匹配到的 hashtag 会从正文里删掉。草稿类 label 不进 tags。
- **可选元信息**：正文顶部的 `<!-- slug: xxx -->` / `<!-- description: xxx -->` / `<!-- date: xxx -->` 注释可覆盖默认值（`extractMeta`）。description 缺省取首段前 100 字。
- **记账文件** `scripts/issues-manifest.json` 记录 `issue number → 生成的文件名`。它是判断「哪些 md 是机器人生成的」的唯一依据，用于改标题时删旧文件、Issue 消失时清残留。**不要手工编辑或删除它**。
- **限流**：无 token 时匿名请求 60 次/小时；CI 里注入 `GITHUB_TOKEN` 后 5000 次/小时。本地 `pnpm sync` 不带 token 容易撞限流。
- 环境变量：`GITHUB_REPOSITORY`（默认 `myogg/astro`）、`GITHUB_TOKEN` / `GH_TOKEN`、`ALLOWED_AUTHORS`。

**改这个脚本时绝对不要用桩数据跑真实同步** —— 桩里的短 body 会覆盖线上真实文章正文（已发生过一次，靠 `git checkout --` 救回）。要测就 stub `globalThis.fetch` 并把输出指到临时路径。

### 评论区与 XSS 约束

评论数据在 `src/data/comments.json`，结构 `{ "<issue number>": [{ id, author, authorUrl, avatar, date, url, body }] }`，由 `src/components/post-comments.astro` 渲染。

**硬性约束：陌生人评论内容绝不能拼进 `.md` 文件。** Astro 会渲染 Markdown 正文里的原始 HTML，那等于把 XSS 直接送上线。因此评论必须走结构化 JSON，并在组件里用 `{comment.body}` 表达式输出（Astro 自动转义），配 `whitespace-pre-line break-words` 保留换行。评论里的 Markdown **不解析**，这是有意的。同步时已过滤 `user.type === "Bot"` 的评论。

### 内容 schema

`src/content/config.js`（`type: "content"`）：

```yaml
---
title: "标题"                  # 必填
description: "SEO 与列表摘要"    # 必填
dateFormatted: "Apr 10, 2026"  # 必填，格式固定 "Mon DD, YYYY"
tags: [tag1, tag2]             # 可选，默认 []
issue: 12                      # 可选，来自 GitHub Issue 的文章才有
---
```

硬性规则：
- **不要加 `layout` 字段** —— 布局由 `post/[slug].astro` 施加，加了会导致标题渲染两次。
- **不要在正文里写 `# 标题`** —— `post.astro` 已把 `frontmatter.title` 渲染成 h1。
- **不要用 `date` 字段**，schema 只认 `dateFormatted`。
- 文件名 `YYYY-MM-DD-slug.md`（Jekyll 惯例），文件名里的日期与 `dateFormatted` 相互独立。
- 文件名避开冒号、引号等特殊字符，会破坏 YAML 解析。

### 日期解析没有集中化（重要坑）

把 `dateFormatted` 按空格拆成「月 日 年」的逻辑在 **7 个文件**里各写了一遍：

`src/pages/post/[slug].astro`、`src/pages/posts/index.astro`、`src/pages/posts/[page].astro`、`src/pages/tags/[tag].astro`、`src/pages/search.astro`、`src/pages/rss.xml.ts`、`src/components/posts-loop.astro`

没有共享日期工具。**一旦改日期格式，这 7 处都要同步改。**

### 路由

| 文件 | 路由 | 说明 |
|---|---|---|
| `index.astro` | `/` | 首页：简介 + 项目卡片 + 最近 3 篇 + RSS 订阅 |
| `posts/index.astro` | `/posts` | 归档第 1 页 |
| `posts/[page].astro` | `/posts/2`, `/posts/3`… | 归档后续页 |
| `post/[slug].astro` | `/post/:slug` | 文章页：TTS 播放器、标签、上下篇、评论区 |
| `search.astro` | `/search` | 客户端搜索 |
| `about.astro` | `/about` | 简介、经历、友链 |
| `tags/index.astro` | `/tags` | 标签云（不在导航里） |
| `tags/[tag].astro` | `/tags/:tag` | 按标签筛选 |
| `rss.xml.ts` | `/rss.xml` | RSS |

导航由 `src/collections/menu.json` 驱动（当前：博客 `/posts`、搜索 `/search`、关于 `/about`），`header.astro` 同时渲染桌面和移动态。**没有 `/projects` 路由**，`projects.json` 只驱动首页的项目卡片。

搜索是构建期预计算 + 浏览器端过滤：`search.astro` 在 frontmatter 里把所有文章的 title/description/tags 拼成小写检索文本随页面发出，内联脚本本地过滤。无外部搜索服务，无 Pagefind。

### `src/collections/` vs `src/content/` vs `src/data/`

名字像但完全无关：

- `src/content/` —— Astro content collections（文章 + schema 校验）
- `src/collections/` —— 手写的静态 JSON 数据
  - `menu.json` → `header.astro` 导航
  - `projects.json` → `home/projects.astro` + `project.astro` 首页项目卡片
  - `links.json` → `about-link.astro` 友链（含 emoji icon）
  - `experiences.json` → `about-experience.astro` 经历时间线
- `src/data/` —— 机器人生成的数据（目前只有 `comments.json`），不要手写

### 布局

- `main.astro` —— 全局外壳。SEO meta（标题格式 `{page} | 北方的博客`，默认描述「北方的博客 — 生活感悟与技术探索」）、Open Graph / Twitter card、header/footer、暗色模式预加载、中文字体、`.prose` 排版、外链处理。接受 `title` 和可选 `description`，页面/文章可覆盖 `description`。
- `post.astro` —— 文章页布局。包裹 `main`，渲染标题 + 日期 + **TTS 播放器**，正文塞进 `<article id="article-content">`，底部有 `nav` slot 放上下篇。

### TTS 播放器

`post.astro` 里一段较长的 `<script is:inline>`，播客风格控制条（对齐 OpenAI 文章页）：

- 两个状态：未开播 `▶ 听全文 │ 估算总时长 ⋯ 🔗 分享`；播放中 `⏸ 已播时长 │ ↺15 ↻15 1x ⋯ 🔗 分享`。分隔线做了两个各自切换，因为两种布局里它位置不同。
- 显示/隐藏用 Tailwind 的 `hidden` **类**而非 HTML `hidden` 属性 —— 带 `flex` 的元素会盖掉 `[hidden]` 的 `display:none`。产物 CSS 里 `.hidden` 排在 `.flex` 之后，所以类的写法压得住。
- 正文按 300 字切段（在 `。！？\n` 处断），调 `https://tts.134688.xyz/api/synthesis`（`zh-CN-XiaoxiaoNeural`，token 硬编码在脚本里），blob 缓存 + 预取下一段，支持跨分段 ±15 秒 seek 和 1x~2x 五档倍速。
- 总时长是**估算值**（`CHARS_PER_SEC = 4.8`），因为音频要点播放才逐段合成，事前拿不到真实长度。
- `readableText()` 只取 `#article-content` 直接子元素中**不含 `not-prose` class** 的部分。标签块和评论区都带 `not-prose`，靠这个避免被朗读。**新增文章底部区块时记得加 `not-prose`**，否则会被念出来。
- 找不到 `#article-content` 时整个播放器隐藏。

### 组件

- `header.astro` / `footer.astro` / `logo.astro` —— 站点框架
- `posts-list.astro` —— 文章卡片列表的唯一实现，被 `posts-loop.astro`（首页）、`posts/index.astro`、`posts/[page].astro`、`tags/[tag].astro` 复用。**列表页标签上限 2 个**（`slice(0, 2)`），多的在文章详情页展示；`showMoreTag` 默认 true 但所有调用方都传了 `false`，所以 `+N` 实际不显示。
- `posts-pagination.astro` —— 分页 UI
- `post-comments.astro` —— Issue 评论区
- `page-heading.astro` —— 搜索/标签/关于页共用的标题头
- `home/projects.astro` / `home/writings.astro` / `home/separator.astro` —— 首页分区
- `button.astro`、`project.astro`、`about-link.astro`、`about-experience.astro`、`square*.astro`（装饰）

改文章卡片或归档行为时改共享组件，别在页面里复制标记。

### 样式与排版

- Tailwind（`@astrojs/tailwind`）+ `@tailwindcss/typography`
- 暗色模式走 Tailwind `class` 策略。`main.astro` 里一段阻塞式内联脚本在首次绘制前读 `localStorage.getItem('dark_mode')` 加 `dark` class，避免闪白；`header.astro` 的开关切换日/夜图标与文案并写回 localStorage。
- 中文字体 LXGW WenKai（正文）+ WenKai Mono（等宽）从 jsDelivr CDN 加载，CDN 挂了回退 `STSong` / `Microsoft YaHei`。标题用系统 sans-serif。
- `.prose` 首段有 3.5em 首字下沉（`::first-letter`，左浮动），并启用 `hanging-punctuation: first allow-end last`。
- `main.astro` 末尾的内联脚本给所有 `.prose a[href^="http"]` 加 `target="_blank"` + `rel="nofollow noopener noreferrer"`。正文里的绝对 URL 一律新窗口打开，站内相对链接不受影响。
- Biome 配置在 `biome.json`，通过 `vcs.useIgnoreFile` 尊重 `.gitignore`。

### 外部注入点

`main.astro` 会把 `import.meta.env.HEADER_INJECT` 渲染进 `<head>`、`FOOTER_INJECT` 渲染到 `</body>` 前（`<Fragment set:html>`）。这是给统计脚本等外部 HTML 留的钩子，不清楚依赖关系前不要删。

### 静态资源

`public/` 原样发布：

- `assets/css/main.css`、`assets/js/main.js` —— 全局样式与脚本
- `assets/images/projects/`、`experiences/`、`posts/` —— 各类图片
- `assets/images/photo.png` —— 首页头像

注：历史文章里失效的 `![](...)` 图片链接已在 2026-09 批量清除，正文里的 `<audio>` / `<video>` 外链保留。
