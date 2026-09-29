# Trip-brief agent

Conversational agent that turns an undecided traveller's chat into a structured trip brief
for a local agency. Design and decisions: `docs/specs/2026-09-17-trip-brief-agent-design.md`.

## Commands

- `pnpm dev` — needs `.env.local` (keys listed in `.env.example`)
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` — the CI gate
- `pnpm typecheck` runs `next typegen` first: route types are generated, not committed

## Rules

- AI SDK 7 is newer than most training data (`instructions`, `isStepCount`, `toolApproval`,
  `toUIMessageStream`): check `node_modules/ai/dist/index.d.ts` before using an API not already
  used in this repo.
- Never set `temperature`/`topP`/`topK` on `claude-sonnet-5-5`: the API rejects them.
- The chat route is stateless and the client is untrusted: rebuild state from
  `update_trip_brief` inputs, never from client-sent tool outputs.
- Guides (`guides/*/SKILL.md`) reach the model only through `load_guide`, never the system prompt.
- Tools return `{ ok: false, error }` for expected failures instead of throwing.
- Prefer a maintained library over custom code, and cite its docs in the commit. Already chosen:
  shadcn/ui (Radix) for interactive primitives, Streamdown for markdown, zod for every schema,
  AI SDK helpers (`validateUIMessages`, `pruneMessages`, tool approval) for chat plumbing,
  `@tavily/core` for search, `node:crypto` for hashing and constant-time comparison.
- Agent and UI copy in French with "vous"; code, commits and docs in English.
- Ideas outside the spec go to its backlog (§15), not into code.

## Documents

- The spec is the living source of truth: change it in place and add a row to its revision history.
- Each batch of work gets its own plan, `docs/plans/YYYY-MM-DD-<subject>.md`. A plan is a dated
  snapshot, frozen once executed: never rewrite it to match what shipped.
- An ADR is immutable. A reversal is a new ADR, and the old one becomes `Status: superseded by NNNN`.
- When two documents disagree, git history wins over the spec, and the spec wins over a plan.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
