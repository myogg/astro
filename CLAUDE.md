# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository is an Astro 4 static personal blog/portfolio site built from the `astro-aria` template and then customized for a Chinese-language blog.

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
npm run build
npm run check
npx astro check
npx astro build
```

Notes:
- `package.json` declares `pnpm@9.12.2`, so prefer `pnpm` for dependency and script commands.
- `npm run build` also works in this repo and runs `astro check && astro build`.
- `npm run check` runs `biome check --apply-unsafe .`, which formats/fixes files in place; do not treat it as a read-only lint command.
- There is no dedicated automated test suite at the moment. Validation is done with `astro check` and a production build.

## Architecture

### Content model

Posts are Astro content collection entries loaded with `getCollection("post")`. Frontmatter is validated by `src/content/config.js` and currently requires:
- `title`
- `description`
- `dateFormatted`
- `tags` (defaults to `[]`)

A lot of route logic depends on `dateFormatted` being a string that can be parsed by splitting `month day year`. If you change the date format, you must update every route that sorts or emits dates.

### Layout and shared UI

`src/layouts/main.astro` is the global shell for most pages:
- sets `<title>` and meta tags
- injects header/footer
- enables dark mode early from `localStorage`
- loads shared CSS/JS from `public/assets`
- contains extra typography styling for Chinese content in `.prose`

`src/layouts/post.astro` wraps article pages and provides the article container plus the bottom nav slot.

Navigation is data-driven from `src/collections/menu.json`, and `src/components/header.astro` renders that menu for both desktop and mobile states.

### Routing structure

Important route patterns:
- `src/pages/index.astro` assembles the homepage from section components
- `src/pages/post/[slug].astro` renders individual posts and computes previous/next post links from a globally sorted post list
- `src/pages/posts/index.astro` is archive page 1 (`/posts`)
- `src/pages/posts/[page].astro` statically generates later archive pages (`/posts/2`, `/posts/3`, ...)
- `src/pages/tags/[tag].astro` groups posts by tag at build time
- `src/pages/search.astro` builds a lightweight client-side search index in page frontmatter and filters in the browser
- `src/pages/rss.xml.ts` emits the RSS feed from the same content collection

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

### Styling stack

- Tailwind is enabled through `@astrojs/tailwind` in `astro.config.mjs`
- Tailwind typography plugin is enabled in `tailwind.config.mjs`
- Biome is configured in `biome.json` for linting/import organization

Most styling is utility-class based in `.astro` files, with a small amount of global typography and dark-mode behavior in `src/layouts/main.astro`.

## Build and deployment assumptions

- `astro.config.mjs` sets `site` to `https://134688.xyz`; feeds and canonical absolute URLs depend on this.
- `tsconfig.json` excludes `dist`, so generated output should not be pulled into diagnostics.
- `dist/` is build output; do not edit it directly.

## Existing CLAUDE guidance to replace

The parent-level `D:/nocode/CLAUDE.md` describes an older two-project setup (`Gitblog` + `aria`) that does not match this repository’s current Astro codebase. For work inside `D:/nocode/astro-aria`, use this local file instead.