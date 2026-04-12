# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Commands

- **Dev server**: `pnpm dev` or `pnpm start`
- **Build**: `pnpm build` (runs `astro check` → `astro build` → `pagefind --site dist` → copies index to `public/pagefind/`)
- **Lint/Format**: `pnpm check` (Biome with `--apply-unsafe`)
- **Preview built site**: `pnpm preview`

Package manager is **pnpm** (v9). Site URL: `https://134688.xyz` (set in `astro.config.mjs`).

## Architecture

Astro 4 static site (personal blog), deployed on Cloudflare Pages. No SSR adapter — purely static output.

### Content System

Blog posts live in `src/content/post/` as Markdown files with Astro content collections. Schema in `src/content/config.js`:

```yaml
---
title: "Post Title"
description: "Short description for post list"
dateFormatted: "Apr 10, 2026"
tags:
  - tag1
  - tag2
---
```

Key rules:
- **No `layout` field** in frontmatter — post layout is applied by `post/[slug].astro`, not per-file layout
- **Do not** add `# Title` in post body — `post.astro` layout renders `frontmatter.title` as h1
- File names: `YYYY-MM-DD-slug.md` (Jekyll convention)
- Avoid special characters (colons, quotes) in file names — they break YAML parsing
- `tags` is optional, defaults to empty array

### Data Files

`src/collections/` holds JSON data:
- `menu.json` — navigation menu (Posts, Projects, Tags, Search, About)
- `projects.json` — project cards (name, description, image, url)
- `links.json` — friend links on About page (name, url, description, icon)
- `experiences.json` — work experience entries on About page

### Layouts

- `main.astro` — root layout (HTML shell, header, footer, dark mode, Chinese serif fonts, external link handling)
- `post.astro` — blog post layout (wraps main, renders title + date, article body with `data-pagefind-body`, nav slot for prev/next)

### Pages

| Page | Route | Notes |
|---|---|---|
| `index.astro` | `/` | Homepage (intro, projects, writings with RSS subscribe) |
| `posts.astro` | `/posts` | Full post listing with tags |
| `post/[slug].astro` | `/post/:slug` | Dynamic post page with prev/next navigation |
| `projects.astro` | `/projects` | Project listing |
| `about.astro` | `/about` | Bio, experiences, friend links |
| `tags/index.astro` | `/tags` | Tag cloud |
| `tags/[tag].astro` | `/tags/:tag` | Posts filtered by tag |
| `search.astro` | `/search` | Pagefind-powered search |
| `rss.xml.ts` | `/rss.xml` | RSS feed endpoint |

### Key Components

- `header.astro` / `footer.astro` — site chrome
- `logo.astro` — "✦ xxjss" linking to `/`
- `home/projects.astro` / `home/writings.astro` / `home/separator.astro` — homepage sections
- `about-link.astro` — friend link card (accepts icon prop for emoji)
- `about-experience.astro` — work experience card
- `posts-loop.astro` — post list renderer (used on homepage)
- `page-heading.astro` — reusable page title + description
- `project.astro` — project card
- `button.astro` — CTA button
- `square.astro` / `square-line.astro` / `square-lines.astro` — decorative elements

### Search (Pagefind)

Search uses Pagefind for static site search:
- Build generates index in `dist/pagefind/`, copied to `public/pagefind/` for dev mode
- `search.astro` uses `is:inline` script to dynamically load Pagefind JS (avoids Vite build errors)
- Article content has `data-pagefind-body` attribute for indexing
- `public/pagefind/` is gitignored — regenerated each build

### Typography & Styling

- Tailwind CSS with `@tailwindcss/typography` plugin
- Chinese serif font (LXGW WenKai) loaded via CDN for prose body text
- Headings use system sans-serif stack
- Drop cap (`::first-letter`) on first paragraph with system serif font
- `hanging-punctuation: first allow-end last` on prose
- Dark mode via `class` strategy (toggle in header)
- External links in prose auto-get `target="_blank"` + `rel="nofollow noopener noreferrer"`

### Static Assets

`public/` is served as-is:
- `assets/images/projects/` — project screenshots
- `assets/images/experiences/` — experience/company icons
- `assets/images/posts/` — post cover images
- `assets/images/photo.png` — homepage portrait
