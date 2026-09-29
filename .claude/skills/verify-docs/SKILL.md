---
name: verify-docs
description: Check official documentation before writing third-party configuration or using an SDK API for the first time in this repo (Next.js, AI SDK, Anthropic, Tavily, shadcn, Vitest, GitHub Actions, Vercel, Claude Code settings). Use before editing such files or calling such APIs.
---

1. Resolve the library in Context7 and query the exact option or API.
2. If Context7 is missing or outdated, fetch the official docs page.
3. For TypeScript APIs, confirm the signature in `node_modules/<pkg>/dist/*.d.ts` of the installed version.
4. If none confirms it, say it is unverified and do not write it.
5. Put the URL(s) in the commit message body as `Sources: ...`.
