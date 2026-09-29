# Architecture

This document describes the system as built and is the source of truth for its scope. The
decisions behind each major choice are in [`docs/adr/`](adr/).

## Scope

**Goal.** Turn an undecided traveller's chat into a structured trip brief a local agency can act
on: destination, period, duration, travellers and budget, each with the traveller's words and
whether they said it or the agent inferred it.

**In scope.** Choice questions, sourced web search, destination cards, the brief panel, a recap the
traveller approves, and a simulated send.

**Out of scope.** Itineraries, prices, accounts, persistence and a real send to an agency.

## Pattern

Hybrid. An undecided traveller follows no fixed path, so the model chooses its next action turn
by turn, and the core is an agentic loop: `streamText` runs up to 10 steps, and at each step the model answers, asks a choice
question, searches, shows a card, updates the brief or proposes the recap. The loop stops on the
step cap, and the turn that sends an approved Demande de devis does not enter it at all. Around it,
everything that must not depend on the model's judgement is a deterministic gate in code:

- brief readiness (`missingForRecap` / `isReadyForRecap`),
- the family card contract (for a family, a card needs `forChildren` and at least one alert),
- catalogue coverage (destination ids are a zod enum built from the catalogue),
- source provenance (a card's sources must come from a `search_web` result in this conversation),
- family health check (for a family, a card needs a successful `search_web` with topic
  `health_formalities` whose query names that destination),
- sending (`sendDenial` = readiness and an approval that names the current brief hash).

The model can be wrong about any of these and the gate still holds: the tool returns a structured
error saying what to do instead, and the model recovers from it inside the same turn. No step is
forced onto a tool. Guidance reaches the model through state rather than instructions: the family
guide rides on the `update_trip_brief` result that first records children, and the card's fields
(`forChildren`, `alerts`, `travelBetter`) are where that guidance and the responsible-travel
principles show.

## Deployment shape

One Next.js 16 App Router application that runs as a single unit: the chat UI is a client
component and the agent runs in the `POST /api/chat` route handler (`maxDuration = 120`). There
is no database and no server-side session. Reloading the page clears the conversation.

The app runs locally from the repository, not hosted; what that costs in
exposure is in the threat model below.

```mermaid
flowchart LR
  U[Traveller] --> UI
  subgraph Browser
    UI[Chat page · useChat]
    UI --> Q[Choice card]
    UI --> C[Destination card + OSM map]
    UI --> R[Recap / approval card]
    UI --> P[Project panel]
  end
  UI -- UI messages --> API[/POST /api/chat/]
  API --> V{body size · validateUIMessages · checkConversation}
  V --> F[deriveConversationState · rewrite brief and card outputs · add today · prune old searches · cache breakpoint]
  F --> ST[streamText · claude-sonnet-5-5 · effort medium]
  ST <--> T1[search_web] --> TV[(Tavily)]
  ST <--> T3[update_trip_brief] --> FS[(guides/family_travel/SKILL.md)]
  ST <--> T4[show_destination_card]
  ST <--> T5[propose_quote_request]
  T3 & T4 & T5 --> GATE{{gates: readiness · family card · catalogue · provenance · family health}}
  GATE --- CAT[(destinations.json)]
  ST -. client tool .-> T6[ask_traveler] -.-> Q
```

## Request lifecycle

Every turn sends the whole UI message history. `POST /api/chat` processes it in this order:

1. **Body parse** — the raw body is rejected above 200,000 characters (`413 payload_too_large`),
   then parsed as JSON and shaped by zod as `{ messages: unknown[] }` (`400 invalid_body`).
2. **`validateUIMessages`** — validates every tool part's **input** against that tool's
   `inputSchema`, and its **output** only for a tool that declares an `outputSchema`, which
   `ask_traveler`, `search_web`, `show_destination_card` and `propose_quote_request` do. A
   `TypeValidationError` or `InvalidArgumentError` becomes `400 invalid_messages`; anything else is
   rethrown. A tool part it cannot attribute to a declared tool — an unknown tool name, or an empty
   input that fails the `inputSchema` — is not rejected but rewritten as a `dynamic-tool` part
   carrying its unchecked output, which step 3 catches.
3. **`checkConversation`** — an allowlist over the parts a message may carry: `text`, `step-start`
   and `tool-*`, which is everything the app emits. A `file` part, a `data-*` part or the
   `dynamic-tool` part of step 2 is rejected, none of them being `tool-*`. The four outcomes are
   returned verbatim as the wire error: `400 system_message` for a client-sent `system` message,
   `400 unexpected_part` for any other part type, `413 too_many_messages` above 80 messages and
   `413 message_too_long` for a user text part longer than 2,000 characters.
4. **`deriveConversationState`** — rebuilds `{ brief, familyGuidanceGiven, searchUrls,
   healthSearches }` by replaying the **inputs** of `update_trip_brief`, the URLs carried by
   client-sent `search_web` outputs and the queries of the successful `health_formalities` ones
   (through `recordSearch`, which the live tool calls too; a search counts from the next
   `step-start` part or the end of its message, as live, where a step's tool calls run together
   and a card called alongside its health search is refused), and the recap promotion (`applySend`) of every successful `propose_quote_request`
   output — the one client-sent output that moves the brief rather than the sets beside it. This
   state is what the gates read.
5. **The closing turn** — when the last assistant message carries an approved
   `propose_quote_request`, `sendQuoteRequest` applies the same gate and the same promotion the
   tool's `execute` does, and a successful send is streamed on its own: the tool output, no model
   call, no text. The AI SDK executes an approved tool call before the first step and then always
   calls the model once, so no `stopWhen` can end a turn that has not begun. The sent card says
   what happens next, and the sentence the model wrote after it introduced a demande that was
   already gone. A refused approval, or a version the gate denies, falls through to the steps
   below, where the model answers the traveller.
6. **`prepareModelMessages`** — rewrites the history the model will see: every historical
   `update_trip_brief` output is recomputed from its input (an invalid patch becomes a `validation`
   tool failure; the update that first records children gets the family guide re-read from disk,
   once per conversation), every `show_destination_card` output is rebuilt from its input against
   the replayed state, today's date is appended to the first user
   message, `convertToModelMessages` produces model messages, `pruneMessages` drops `search_web`
   calls and results older than the last six messages, and an `ephemeral` `cacheControl` breakpoint
   is set on the last message.
7. **`streamText`** — `claude-sonnet-5-5`, `effort: "medium"`, `fallbacks: "default"`, the cached system prompt as
   `instructions`, the six tools, `toolApproval` on `propose_quote_request`,
   `stopWhen: isStepCount(10)`, and `prepareStep` forcing `toolChoice: "none"` on the last step so
   the cap ends in a French sentence rather than a truncated tool call. `onError` logs the error
   name and, for an `APICallError`, the status code only — never conversation content.
8. **`toUIMessageStream` / `createUIMessageStreamResponse`** — streams typed UI parts back. A 429
   or 529 is mapped to "Le service est très sollicité. Réessayez dans un instant.", anything else
   to a generic French message; the client only renders messages from that known list.

Two cache breakpoints are used: one on the system prompt, one on the last message. Today's date
goes into the first user turn rather than the system prompt: keeping it out of the prompt means the
prompt caches across days, and pinning it to the first turn means the history prefix is byte
identical from one turn to the next, which is what the five-minute ephemeral entry actually needs.
Pruning still truncates the reusable prefix once the oldest `search_web` call leaves the
six-message window.

## Client round trips

`ask_traveler` has no `execute`: it is answered in the browser. The client sends automatically
when the last assistant message is complete with tool results or with approval responses
(`lastAssistantMessageIsCompleteWithToolCalls`, `lastAssistantMessageIsCompleteWithApprovalResponses`),
except when that message carries a sent brief: the send closes the conversation, so
`shouldSendAutomatically` stops there rather than asking the model to comment on it.

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as /api/chat
  participant M as Model
  B->>S: user message
  S->>M: history + tools
  M-->>S: tool call ask_traveler(question, options)
  S-->>B: stream part tool-ask_traveler (input-available)
  B->>B: render choice card, announce "Nouvelle question"
  alt option(s) picked on the card
    B->>B: addToolOutput({ selected })
  else user types in the main input
    B->>B: addToolOutput({ freeText })
  end
  B->>S: auto-resend (last assistant message has all tool results)
  S->>M: history incl. tool result
  M-->>B: next step streamed
```

If the model opens more than one question in a step, only the first is answered; the others are
closed with the error output "Une seule question à la fois."

The recap is the only approval point. `propose_quote_request` is gated twice: the approval
callback decides whether the traveller is even asked, and `sendQuoteRequest` re-checks before
sending, from the tool's `execute` or from the closing turn. A successful send ends the turn there.

The traveller can also write instead of clicking. The AI SDK rejects a tool call left without a
result before the next user message (`MissingToolResultsError`), so `prepareModelMessages` resolves
every recap still awaiting approval before the last message as refused, with a reason telling the
model to take the message into account. On the client, only the last message's recap keeps its
buttons (`pendingApproval`); an earlier one says it was not sent.

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as /api/chat
  participant M as Model
  M-->>S: propose_quote_request(briefVersion)
  S->>S: approvalFor(state): missingForRecap, version match
  alt denied
    S-->>M: denial reason (what is missing, or the current version)
  else user-approval
    S-->>B: approval requested + recap card
    alt "Envoyer"
      B->>S: approved
      S->>S: sendDenial = readiness + approved hash matches
      S->>S: confirmMandatoryFields
      S-->>B: simulated Demande de devis (agency text + JSON)
    else "Modifier" / "Abandonner"
      B->>S: denied, reason "modifier" or "abandon"
      M-->>B: asks what to change, or closes without sending
    else traveller writes a message
      B->>S: new user message after the pending recap
      S->>S: recap resolved as refused (typed reply)
      M-->>B: takes the message into account
    end
  end
```

## Tools

Six tools, each mapping to one capability of the agent. The count is deliberate: the
Claude Certified Architect exam guide (Foundations, task 2.3) warns that too many tools degrade
selection (18 tools versus 4–5 in its example). Every description states the input format, when to
use the tool and when not to. Inputs are validated with zod on the server even under strict tool
use, because strict JSON Schema does not support `minimum`/`maximum`/`minLength`/`maxLength` and
limits `minItems` to 0 or 1
([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
Expected failures return `{ ok: false, error: { errorCategory, isRetryable, message } }` with
`errorCategory` in `validation | transient | business`; only `transient` is retryable. Parallel
tool calls stay enabled, so a brief update and a search can run in the same step.

| Tool                     | Runs                        | Contract                                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `ask_traveler`           | client (no `execute`)       | `intro?` (up to 1,200 characters, rendered above the question), `question`, `options` (2–6, `{ id, label, description? }`), `multiSelect`; output `{ selected: id[] }` or `{ freeText }`. Free text through the main input always answers the pending question.                                                                                 |
| `search_web`             | server                      | `query`, `topic: "general" \| "health_formalities"`. Tavily, `searchDepth: "basic"`, timeout 8 s, at most 5 results, snippets truncated to 400 characters; `health_formalities` restricts results to `diplomatie.gouv.fr`, `pasteur.fr`, `who.int`. An empty list is a valid result; a failure is `transient`. |
| `show_destination_card`  | server                      | `destinationId` (catalogue enum), `region`, `why`, `bestPeriod`, `highlights[]`, `alerts[]`, `sources[{ title, url }]`, `coordinates`, `flightTimeFromParis`, `travelBetter` (one responsible-travel suggestion), `forChildren?` — `region` and `flightTimeFromParis` are required, two cards of a turn being aligned row by row on them. Gates: when family signals exist, `forChildren` and at least one alert (`validation` error naming what to add), every source URL seen in a `search_web` result (`validation` error), and, when family signals exist, a successful `health_formalities` search whose query names the destination — its label or the label with spaces and hyphens removed (« Vietnam » for « Viêt Nam »), compared after folding case, accents and punctuation, as whole words (`business` error naming the search to run). An unknown destination id fails input validation. Once the card passes, the server looks up one Commons photo from the destination's English name (`Intl.DisplayNames`); a failed lookup leaves the card without one. |
| `show_photos`            | server                      | `query` (3–100 characters, in English) → up to 4 Wikimedia Commons photos `{ url, width, height, pageUrl, author, license }`, bitmap thumbnails on `upload.wikimedia.org` or `thumb.wikimedia.org` only, landscape first. The model reads only how many were shown. A Commons failure is `transient`. |
| `update_trip_brief`      | server                      | A partial patch → `{ ok: true, brief, version, missingForRecap[], familyGuidance? }`. `familyGuidance` is the family guide body, returned once per conversation, on the update that first records children.                                                                       |
| `propose_quote_request`  | server, behind tool approval| `briefVersion` (16 hex characters). The approval callback denies with the missing items, or the current version when the hash is stale; otherwise the recap card is shown. `execute` re-runs the same `sendDenial` gate, promotes the mandatory fields to `confirmed` in the returned brief and returns it with the agency-readable text. |

### Text before a tool call

On `claude-sonnet-5-5`, text longer than a sentence or two that the model writes before a tool
call comes back as a thinking block, and only a summary of it is ever returned; the interface does
not render thinking. The live evaluation caught it: the answer to « c'est où Zanzibar ? » went there,
and the traveller saw photos and a question. A choice question ends the turn, so that is where an
answer lands before a tool; `ask_traveler` carries it in `intro`, rendered above the question. Text
written after the last tool call of a turn is an ordinary text part.

### Guidance

The family guide reaches the model when it becomes relevant, from the brief's state: `recordPatch`
attaches it as `familyGuidance` to the `update_trip_brief` result that first records children, and
`familyGuidanceGiven` keeps it to one copy per conversation, however often a history adds and
removes children. The replay re-reads it from disk on that same update, so a client-sent value
never reaches the model ([0009](adr/0009-guidance-from-brief-state.md)).

Text alone is followed only some of the time, so the card contract carries what the guidance asks
for. For a family, `buildDestinationCard` refuses a card without `forChildren` or without at least
one alert, and without a health search naming the destination; every card carries `travelBetter`,
the responsible-travel suggestion. The responsible-travel principles apply to every
recommendation, so they sit in the system prompt, in five lines.

`guides/family_travel/SKILL.md` covers tone, what to ask or check for children (ages, rhythm,
health, accommodation, meals), the signals to raise and the defaults. It is written for this
project.

### Destination catalogue

`data/destinations.json` holds the 249 ISO 3166-1 alpha-2 codes with their French names from
Unicode CLDR 48.2.2 (`cldr-core/supplemental/codeMappings.json` and
`cldr-localenames-full/main/fr/territories.json`), generated by `scripts/extract_destinations.py`:
`id` is the code (`VN`), `label` the CLDR name (« Viêt Nam »). CLDR's own groupings (`EU`, `ZZ`,
`XK`…) sit at numeric codes 900 and above and are left out. `destinationIdSchema` is a zod enum
over those ids, so an off-catalogue
destination cannot enter a brief or a card at all. When the traveller wants one, the agent says
plainly that no local agency covers it and proposes two or three nearby catalogue destinations.

## Brief state

The brief is never stored. It is recomputed on every request from the `update_trip_brief` inputs
in the history, then re-validated by `tripBriefSchema`. Each tracked field is
`{ value, status: "confirmed" | "inferred", evidence?, note? }`; an absent field is unknown.
`mergeBrief` is a pure function: a patch replaces a scalar or a whole array, `null` clears a field,
a field named in `resolves` replaces its value and closes the matching contradiction, and a
`confirmed` value replaced without `resolves` opens a contradiction instead of overwriting.
`confirmMandatoryFields` promotes destination, dates, duration, travellers and budget to
`confirmed` when the recap is approved.

The budget is either an amount or `declined: true`, when the traveller prefers to settle it with the
agency; a declined budget needs the traveller's words as `evidence`. `missingForRecap` waits for
one of the two, so the recap cannot be reached with the budget question skipped.

`briefVersion` is the first 16 hex characters of the SHA-256 of the serialised brief;
`JSON.stringify` is stable here because every brief comes out of `tripBriefSchema.parse`, which
emits keys in schema order. That hash is what the approval names, so approving a recap cannot send
a brief that has changed since. It is not shown to the traveller: the recap card is where the brief
an approval is bound to is reviewed, field by field.

The field model is `tripBriefSchema` in `lib/brief/schema.ts`; the merge rules are in
`lib/brief/merge.ts`.

## Threat model

The route is stateless and receives the whole history from the browser, so the client is
untrusted.

- `validateUIMessages` checks every tool part's input against its tool's `inputSchema`. It checks
  an output only where the tool declares an `outputSchema`: five of the six do — `ask_traveler`,
  `search_web`, `show_destination_card`, `show_photos` and `propose_quote_request` — so a forged
  `search_web` output, or a photo off Wikimedia's image hosts, is a `400` rather than something the
  route walks. Photos and their credits never reach the model: `toModelOutput` drops the card's
  photo and turns a `show_photos` output into a fixed count. The one that declares none,
  `update_trip_brief`, has its output replaced before the model call (below), family guidance
  included, as does `show_destination_card`. That leaves `propose_quote_request`: its output is shaped by a
  schema but not recomputed, and the server reads it — a `{ ok: true }` one makes both
  `deriveConversationState` and the replay run `applySend`, which promotes destination, dates,
  duration and travellers to `confirmed` as an approved recap does. The residual below covers what
  that is worth to the client sending it.
- The brief is recomputed from `update_trip_brief` **inputs**; client-sent outputs of that tool
  never reach the model — `prepareModelMessages` overwrites them with the recomputed value.
- The family guidance on an `update_trip_brief` output is re-read from disk, on the one update that
  first records children, so a client-sent value never reaches the model and a handcrafted history
  cannot multiply the file into megabytes of context.
- `validateUIMessages` turns a tool part it cannot attribute to a declared tool into a
  `dynamic-tool` part, whose output no schema checks; `checkConversation` rejects any such part
  with a `400`. It comes from a forged history, or from a tab opened before a tool was removed
  (`load_guide`).
- Destination card and feasibility alert sources are checked against the `search_web` outputs of
  the same conversation. Those outputs come from the client, so a forged search result
  makes a card cite a forged URL — inside that client's own session (see the residual below).
- Sending is simulated and gated server-side by one function, `sendDenial`, called both by the
  approval callback and by `execute`, so the two cannot disagree. Tool
  approval is used without the experimental signing secret precisely because the server re-checks
  readiness and the brief hash.
- Caps: 200,000-character body, 2,000-character user message, 80 messages, 10 steps per turn
  (sized for a brief update plus three searches and three cards). Reaching the step cap ends the turn
  with a French sentence, not a raw error.
- Web results are data, never instructions — stated in the system prompt and never given the
  ability to change a gate.
- No tool has an external side effect. The only "action" is the simulated send, behind human
  approval.
- **Residual, by design.** Recomputing from inputs stops forged outputs, not a forged history.
  `deriveConversationState` replays any `update_trip_brief` input present in the history without
  checking that the assistant emitted it, and `tripBriefPatchSchema` accepts
  `status: "confirmed"`, so a handcrafted history can set the mandatory fields itself, empty
  `missingForRecap` and reach an approved send; the same applies to `searchUrls`,
  `healthSearches` — a forged `health_formalities` search keeps its own family card
  past the health gate, which holds the model, not a client forging its own history — and to the
  `propose_quote_request` output whose presence replays the recap
  promotion. `search_web` outputs are not replayed — re-running the searches would cost a
  Tavily call per historical search on every turn — so a handcrafted snippet reaches the model
  verbatim, the same injection channel forged family guidance would be if it were not re-read.
  Nothing is persisted and the send is simulated, so the blast radius is the session's own client.
  The answer is server-side persistence per `chatId` accepting only the latest message
  ([backlog](#backlog)), which makes the history the server's rather than the client's.

- In the browser: a Content Security Policy (`next.config.ts`) limits images to `'self' data:` and
  Wikimedia's two image hosts, and frames to `https://www.openstreetmap.org`, forbids framing the app, and is served with
  `X-Content-Type-Options: nosniff`; `<Streamdown disallowedElements={["img"]}>` drops markdown
  images outright, so an injected image URL cannot become a request; and the map iframe runs with
  `sandbox="allow-scripts"` and `referrerPolicy="no-referrer"`.

The route authenticates nobody and has no per-IP rate limiting: it is meant to be run locally,
and the Anthropic workspace spend limit is the backstop. `pnpm dev` and `pnpm start` both bind to
`127.0.0.1` for that reason — `next dev` and `next start` otherwise listen on `0.0.0.0`
([Next.js CLI](https://nextjs.org/docs/app/api-reference/cli/next)), which would leave
`/api/chat` open to the local network. Hosting it would need an access control and a rate limit
added first, both in the README's next steps.

## Privacy

The agent asks for no identity data, but a traveller may volunteer health or mobility information,
which is special-category data. The interface carries no notice about it: the README states that
nothing is sent, that a reload ends the conversation and that messages reach the model and the
search provider, this being a prototype run locally rather than a service anyone signs up to.
No conversation is logged or sent anywhere other than the model and
search providers; there is no analytics, no tracker and no tracing in the application. The
agency-readable text carries only what the agency needs. Model inference runs on Anthropic's
first-party API with `global` processing; EU inference is a production requirement, not a property
of this prototype. Tracing in production would need an EU region, masking of `evidence`,
`constraints` and `projectSummary`, and short retention.

## Testing

Vitest covers the domain logic (schema, merge rules, both gates, catalogue, agency text), every
server tool and each of its gates with Tavily mocked, the conversation state and its pruning, the
route's body limits, and the streaming handler driven by `MockLanguageModelV4` from `ai/test`. CI
runs lint, format check, typecheck, tests and build on every push and pull request.

`pnpm eval` (`tests/eval/`) measures behaviour against the real model and Tavily. Each scenario
scripts the traveller's turns; the harness drives `createChatResponse` the way the browser does
(automatic re-posts, free text answering a pending choice, recap approval) and checks outcomes a
traveller or an agency would notice: what the brief records, what the cards say, whether the budget
is asked, whether an injected instruction or the system prompt leaks. It is run by hand before and
after a behaviour change, since the model's answers vary between runs.

## Backlog

Not built. Ideas that come up during implementation and are not in scope go here, not into code.

- Server-side persistence per `chatId`, accepting only the latest message from the client.
- EU inference and a data-processing review.
- Live agency coverage and minimum budgets instead of the static catalogue and search-based
  alerts.
- A real send to an agency, with consent, behind a signed approval.
- Authentication and per-IP rate limiting before any hosted deployment.
