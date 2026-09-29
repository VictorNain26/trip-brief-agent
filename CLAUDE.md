# Trip-brief agent

Conversational agent that turns an undecided traveller's chat into a structured trip brief
for a local agency. Scope, design and backlog: `docs/architecture.md`; decisions: `docs/adr/`.

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
- The family guide (`guides/family_travel/SKILL.md`) reaches the model only through the
  `update_trip_brief` result that first records children; responsible-travel principles live in the
  system prompt. Make the model apply guidance through tool contracts (card fields), not more rules.
- Tools return `{ ok: false, error }` for expected failures instead of throwing.
- Prefer a maintained library over custom code, and cite its docs in the commit. Already chosen:
  shadcn/ui (Radix) for interactive primitives, Streamdown for markdown, zod for every schema,
  AI SDK helpers (`validateUIMessages`, `pruneMessages`, tool approval) for chat plumbing,
  `@tavily/core` for search, `node:crypto` for hashing and constant-time comparison.
- Agent and UI copy in French with "vous"; code, commits and docs in English.
- Ideas outside the scope go to the backlog in `docs/architecture.md`, not into code.

## Documents

- `docs/architecture.md` describes the system as built: change it in the same PR as the code.
- A batch of work carries its plan in the PR description, not in a file.
- An ADR is immutable. A reversal is a new ADR, and the old one becomes `Status: superseded by NNNN`.
- When a document disagrees with the code, the code and its git history win.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
