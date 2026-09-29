# Portability by thin boundaries, not by an abstraction layer

Status: accepted

## Context

[0001-stack](0001-stack.md) picks one runtime and [0002-model](0002-model.md) one provider, and
both say the choice could change: the evaluation may favour another model, EU-only processing may
become mandatory, and a team already running LangGraph would want the agent inside its own
platform. A prototype that can only be thrown away is a bad answer to any of those.

The opposite failure is worse: a provider-agnostic abstraction written for a migration that never
happens, paid for on every change.

## Decision

No abstraction layer. Keep the runtime-specific surface small and known, and write down what each
piece maps to elsewhere.

| This repository                                | Elsewhere                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ask_traveler` (client tool, no `execute`)     | CopilotKit frontend human-in-the-loop                                                                                |
| `load_guide` (file + tool + prerequisite gates)| DeepAgents or Claude Agent SDK skills                                                                                |
| brief recomputed from history                  | LangGraph shared state over AG-UI                                                                                    |
| `anthropic(MODEL_ID)` provider factory         | LiteLLM through an OpenAI-compatible provider; the Anthropic cache breakpoints move to LiteLLM's `cache_control` settings |

What is actually Anthropic-specific in the code: the two `cacheControl` breakpoints (system prompt
and last message) and `providerOptions.anthropic.effort`. Search is a custom tool, not a vendor
server tool, so nothing about grounding moves with the provider.

What is actually AI SDK-specific: the UI message format the client renders, `validateUIMessages`,
`pruneMessages`, `toolApproval` and the stream helpers.

What is portable as-is, because it is plain TypeScript with no runtime import: the whole of
`lib/brief/` (schema, merge rules, readiness gates, version hash, French labels, agency text),
`lib/catalogue.ts`, `lib/agent/search.ts` behind the `SearchFn` type, `lib/agent/guides.ts` and the
guide files, and the system prompt.

## Alternatives considered

**A provider- and runtime-agnostic interface written now.** A `ChatRuntime` port with an AI SDK
adapter would make the migration a config change. Not chosen: it is an abstraction for a need that
does not exist, it would have to model tool approval and client-side tools — the two places where
runtimes differ most — and every feature would then be written twice, against the port and against
the adapter.

**A LiteLLM gateway from the start.** Real value in production: model fallback, one key, one cost
ledger. Not chosen for this prototype, because it adds a service to run for a single-model prototype and
moves the cache-breakpoint syntax into a second configuration surface. It is in the spec's P2
backlog.

**No portability consideration at all.** Defensible for a throwaway demo, but the model decision is
explicitly provisional and gated on an evaluation, so the ability to switch is part of that
decision, not a separate wish.

## Consequences

- A model switch is a provider factory change plus the two Anthropic options; the evaluation
  scenarios in [`docs/evaluation.md`](../evaluation.md) are what decides it.
- A runtime switch keeps the domain logic and the tests that cover it, and rewrites the chat
  pipeline and the tool-part rendering. That is a real cost, stated rather than hidden.
- The per-tool porting map is a design claim, not a tested migration. Nothing here has been run on
  CopilotKit, LangGraph or the Agent SDK.
- Keeping search off the vendor server tool costs a Tavily dependency ([0004-search](0004-search.md))
  and buys grounding that does not move when the model does.
