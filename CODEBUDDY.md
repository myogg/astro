# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Commands

- **Dev server**: `pnpm dev` or `pnpm start`
- **Build**: `pnpm build` (runs `astro check` then `astro build`)
- **Lint/Format**: `pnpm check` (Biome with auto-apply)
- **Preview built site**: `pnpm preview`

Package manager is **pnpm** (v9).

## Architecture

This is an Astro 4 static site (personal blog/portfolio), deployed on Cloudflare Pages.

### Content System

Blog posts live in `src/content/post/` as Markdown files with Astro content collections. The schema is defined in `src/content/config.js`:

```yaml
---
layout: ../../layouts/post.astro
title: "Post Title"
description: "Short description for post list"
dateFormatted: "Apr 10, 2026"
---
```

- **Do not** add `# Title` in post body — `post.astro` layout already renders `frontmatter.title` as h1
- File names should follow Jekyll convention: `YYYY-MM-DD-slug.md`
- Avoid special characters (colons, quotes) in file names — they break YAML parsing

### Data Files

`src/collections/` holds JSON data used across pages:
- `menu.json` — navigation menu items
- `projects.json` — project cards (name, description, image, url)
- `links.json` — friend links on About page (name, url, description, icon)

### Layouts

- `main.astro` — root layout (HTML shell, header, footer, dark mode, CSS/JS)
- `post.astro` — blog post layout (wraps main, renders title from frontmatter)

### Pages

- `index.astro` — homepage (intro, projects, writings)
- `posts.astro` — post listing
- `projects.astro` — project listing
- `about.astro` — about page with short bio, friend links, contact

### Key Components

- `header.astro` / `footer.astro` — site chrome
- `home/projects.astro` / `home/writings.astro` — homepage sections
- `about-link.astro` — friend link card (accepts icon prop for emoji)
- `posts-loop.astro` — post list renderer

### Static Assets

`public/` is served as-is. Project images go in `public/assets/images/projects/`.
