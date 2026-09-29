# One Next.js app on the Vercel AI SDK

Status: accepted

## Context

The agent exposes three capabilities end to end: visual choice questions, web search and visual
in-chat content. That means a streaming chat UI, a server that runs an agentic loop, and a protocol
between the two that can carry structured tool parts, not just text. It also has to be runnable
locally with one command, without operating infrastructure.

## Decision

A single Next.js 16 App Router application: the chat page is a client component, the agent runs in
the `POST /api/chat` route handler, and both are one unit `pnpm dev` serves. The prototype runs
locally, so nothing is hosted; the same unit deploys to a platform that runs Next.js when that
becomes the point.

The agent runtime and the UI protocol are the Vercel AI SDK 7 (`ai`, `@ai-sdk/react`,
`@ai-sdk/anthropic`). It gives typed tool parts end to end (`InferUITools` over the tool set, so
the client renders `tool-show_destination_card` with a checked type), client-side tools with no
`execute` for `ask_traveler`, native tool approval for the send, and a provider abstraction that
keeps the model swappable.

## Alternatives considered

**CopilotKit + LangGraph / DeepAgents.** Native human-in-the-loop, shared state and skills — all
three are things this agent needs. Not chosen: it requires two services (the UI runtime and a
LangGraph server), its React API is split between v1 and v2 entry points, and the AG-UI client
packages are at 0.0.x
([CopilotKit LangGraph quickstart](https://docs.copilotkit.ai/integrations/langgraph/quickstart),
[DeepAgents skills](https://docs.langchain.com/oss/javascript/deepagents/skills)). Two runtimes for
a single-service prototype is cost without return here.

**Claude Agent SDK.** Native Skills and `AskUserQuestion` map almost exactly onto `load_guide` and
`ask_traveler`. Not chosen: it runs one CLI subprocess per session and ships no UI layer, so
multi-user hosting means long-lived containers with session affinity
([hosting](https://code.claude.com/docs/en/agent-sdk/hosting)). That is a different operational
shape from a stateless route handler.

**A hand-written streaming loop over the Anthropic SDK.** Fewer dependencies, but it means
reimplementing the stream protocol, message validation, tool approval, client-side tools and
pruning — all of which the AI SDK provides and tests.

## Consequences

- One repository, one unit to run; `pnpm install && pnpm dev` is the whole setup.
- The UI is coupled to the AI SDK's UI message format. Porting the interface to another runtime
  means re-rendering tool parts against that runtime's protocol (see
  [0006-portability](0006-portability.md)).
- AI SDK 7 is recent enough that several APIs are newer than most model training data; every
  non-obvious use in this repo was checked against `node_modules/ai/dist/index.d.ts` or the
  official docs before being written, and `CLAUDE.md` records that rule for future changes.
- Human-in-the-loop had to be built on the SDK's primitives (a client tool plus tool approval)
  rather than being handed over by the framework: `lib/chat/client-state.ts` routes answers to the
  pending question and `approvalFor` decides the send server-side.
