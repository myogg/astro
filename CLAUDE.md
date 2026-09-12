# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository is a fully static (SSG) Astro 4 personal blog/portfolio site built from the `astro-aria` template and then customized for a Chinese-language blog. There is no SSR or hybrid mode — all pages are pre-rendered at build time.

The site is content-driven:
- blog posts live in `src/content/post/*.md`
- Astro content collections validate post frontmatter in `src/content/config.js`
- routes under `src/pages/` statically generate the homepage, post pages, paginated post archive, tag pages, search page, and RSS feed

## Common Commands

Run these from the repository root.

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm astro check
pnpm astro build
pnpm check
```

Notes:
- `package.json` declares `pnpm@9.12.2`, so prefer `pnpm`.
- `pnpm build` runs `astro check && astro build`.
- `pnpm check` runs `biome check --apply-unsafe .` and may rewrite files in place.
- There is no dedicated automated test suite or single-test command in this repo; validation is `pnpm astro check` plus a production build.

## Architecture

### Content model

Posts are Astro content collection entries loaded with `getCollection("post")`. Frontmatter is validated by `src/content/config.js` and currently requires:
- `title`
- `description`
- `dateFormatted`
- `tags` (defaults to `[]`)

Date parsing is **not centralized** — the `month day year` split logic is duplicated in at least 4 files: `src/pages/post/[slug].astro`, `src/components/posts-loop.astro`, `src/pages/search.astro`, and `src/pages/rss.xml.ts`. If you change the date format, you must update all of them. There is no shared date utility.

### Layout and shared UI

`src/layouts/main.astro` is the global shell for most pages:
- sets `<title>` and meta tags
- injects header/footer
- enables dark mode early from `localStorage`
- loads shared CSS/JS from `public/assets`
- contains extra typography styling for Chinese content in `.prose`

`src/layouts/post.astro` wraps article pages and provides the article container plus the bottom nav slot.

Navigation is data-driven from `src/collections/menu.json`, and `src/components/header.astro` renders that menu for both desktop and mobile states. The tag index exists as a route but is not part of the main nav.

### Routing structure

Important route patterns:
- `src/pages/index.astro` assembles the homepage from section components
- `src/pages/post/[slug].astro` renders individual posts, tag chips, and previous/next links from a globally sorted post list
- `src/pages/posts/index.astro` is archive page 1 (`/posts`)
- `src/pages/posts/[page].astro` statically generates later archive pages (`/posts/2`, `/posts/3`, ...)
- `src/pages/tags/[tag].astro` groups posts by tag at build time
- `src/pages/search.astro` builds a lightweight client-side search index in page frontmatter and filters in the browser
- `src/pages/rss.xml.ts` emits the RSS feed from the same content collection

### Shared UI components

`page-heading.astro` is the shared page title/description header used by the search, tags, and about pages.

`button.astro` is a reusable CTA button component with configurable text and link.

### Post listing flow

The shared archive/recent-post card UI lives in `src/components/posts-list.astro`.

That component is reused by:
- `src/components/posts-loop.astro` for the homepage “recent posts” section
- `src/pages/posts/index.astro`
- `src/pages/posts/[page].astro`

Pagination UI is isolated in `src/components/posts-pagination.astro`.

When changing post cards or archive behavior, update the shared components first instead of duplicating markup in pages.

### Search implementation

Search is intentionally lightweight and local-only.

`src/pages/search.astro`:
- loads all posts at build time
- precomputes lowercase search text from title/description/tags
- ships that list in the generated page
- filters results client-side with inline script

There is no external search service and no Pagefind integration in the app code.

### TTS (Text-to-Speech) playback

`src/layouts/post.astro` contains a significant inline TTS player that reads article content aloud:

- Splits article text into ~300-char chunks at sentence boundaries (`。！？\n`)
- Calls `https://tts.134688.xyz/api/synthesis` with `voiceName=zh-CN-XiaoxiaoNeural` and a hardcoded `token=tts100412`
- Plays the first chunk immediately while the rest continue synthesizing in the background
- A stop button (or `beforeunload`) aborts the current `AbortController` and stops all playback

The TTS UI (play/stop/spinner button with status text) is inside the post layout's date/time pill area. If the article content element (`#article-content`) is missing, the TTS controls are hidden entirely.

### Dark mode

Dark mode uses Tailwind's `class` strategy. A blocking inline `<script>` in `src/layouts/main.astro` reads `localStorage.getItem('dark_mode')` before paint to add the `dark` class. The toggle in `src/components/header.astro` swaps sun/moon icons and "Day mode"/"Night mode" text and writes back to `localStorage`.

### Environment injection points

`src/layouts/main.astro` renders `import.meta.env.HEADER_INJECT` into `<head>` and `import.meta.env.FOOTER_INJECT` at the end of `<body>`. These are external HTML injection hooks (analytics, scripts, etc.) — do not remove them without understanding what depends on them.

### `src/collections/` vs `src/content/`

These are unrelated despite similar naming:
- `src/content/` — Astro content collections (blog posts + schema validation)
- `src/collections/` — static JSON data files that drive several parts of the site:
  - `menu.json` — navigation links rendered by `header.astro`
  - `links.json` — curated "my links" categories displayed on the about page via `about-link.astro`
  - `projects.json` — project cards shown on the homepage via `home/projects.astro` and `project.astro`
  - `experiences.json` — work/experience timeline entries rendered by `about-experience.astro`

### About page and data-driven sections

`src/pages/about.astro` assembles a personal page from multiple JSON data sources:
- A "Short Bio" section with a photo (`about.jpg`)
- A "My Links" section driven by `links.json` — each category renders a grid of `about-link.astro` cards
- An experience timeline from `experiences.json` using `about-experience.astro`
- A "Let's Connect" section with social/email links

The homepage `src/pages/index.astro` also uses data-driven sections:
- `home/projects.astro` reads `projects.json` and renders `project.astro` cards in a responsive grid
- `home/writings.astro` uses `posts-loop.astro` to show the 3 most recent posts, plus an RSS subscription form
- `home/separator.astro` is a decorative section divider

### Content post naming convention

All posts in `src/content/post/` follow the naming pattern `YYYY-MM-DD-slug.md`. The date in the filename is separate from the `dateFormatted` frontmatter field.

### Chinese typography and font loading

`src/layouts/main.astro` loads two web fonts from jsDelivr CDN:
- `lxgw-wenkai-webfont` (prose body)
- `lxgw-wenkai-mono-webfont` (monospace)

The `.prose` class uses a Chinese-first font stack with serif body text and sans-serif headings. The first paragraph of `.prose` content gets a large drop cap (`::first-letter`, 3.5em, floated left). If either CDN link breaks, Chinese text falls back to system fonts like `STSong` and `Microsoft YaHei`.

### External link behavior

An inline script in `main.astro` (just before `</body>`) selects all `.prose a[href^="http"]` links and applies `target="_blank"` and `rel="nofollow noopener noreferrer"` at DOM ready. This means any absolute URL in article prose automatically opens in a new tab. Internal post links and relative URLs are not affected.

### Styling stack

- Tailwind is enabled through `@astrojs/tailwind` in `astro.config.mjs`
- Tailwind typography plugin is enabled in `tailwind.config.mjs`
- Biome is configured in `biome.json` for linting/import organization — it respects `.gitignore` via the `vcs.useIgnoreFile` setting

Most styling is utility-class based in `.astro` files, with a small amount of global typography and dark-mode behavior in `src/layouts/main.astro`.

The `public/assets/` directory contains:
- `css/main.css` — shared global styles loaded via `<script>` (note: loaded as a script, not a stylesheet, so it may inject CSS via JS)
- `js/main.js` — shared global JavaScript
- `images/` — all site images including favicon, photos, and per-post images under `images/posts/`

## Build and deployment assumptions

- `astro.config.mjs` sets `site` to `https://134688.xyz`; feeds and canonical absolute URLs depend on this.
- `tsconfig.json` excludes `dist`, so generated output should not be pulled into diagnostics.
- `dist/` is build output; do not edit it directly.

## Existing CLAUDE guidance to replace

The parent-level `D:/nocode/CLAUDE.md` describes an older two-project setup (`Gitblog` + `aria`) that does not match this repository’s current Astro codebase. For work inside this directory, use this local file instead.