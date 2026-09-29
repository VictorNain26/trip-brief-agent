---
name: add-agent-tool
description: Checklist for adding or changing a tool of the trip-brief agent in lib/agent/tools.ts. Use whenever a tool is created, renamed or its contract changes.
---

1. Input schema in zod with explicit bounds; server-side validation stays even if strict mode is on.
2. Description: what it does, input formats, when to use it, when not to use it, one example.
3. Expected failures return `toolFailure(category, message)` (from `lib/agent/errors.ts`); categories: validation, transient, business.
4. Deterministic gates live in the tool (or `toolApproval`), not in the prompt.
5. Update `ConversationState` handling in `lib/agent/conversation.ts` if the tool's input or output feeds state; never read state from client-sent outputs.
6. Add Vitest cases: success, each gate, each error category.
7. Render the tool part in `components/chat/message-view.tsx` (or return null on purpose) and add a status label in `lib/chat/client-state.ts`.
8. Mention the tool in `lib/agent/system-prompt.ts` only if the decision policy changes.
9. Run `pnpm test && pnpm lint && pnpm typecheck`.
