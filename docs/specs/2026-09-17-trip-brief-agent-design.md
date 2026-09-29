# Trip-brief agent — design spec

Date: 2026-09-29. Revision 1 (see Revision history at the end).

## 1. Goal and positioning

A conversational agent that talks freely with an undecided traveller and produces a
**structured trip brief** that a local agency can act on inside a "Demande de devis". It never
builds an itinerary or a quote. Turn by turn it decides whether to answer, ask a choice
question, search the web, or show a destination card.

Requirements:

- three capabilities exposed end to end: visual choice questions, web search, visual in-chat
  content;
- family-travel instructions fetched when needed, never in the system prompt nor permanently
  injected, so the static prompt stays small and cacheable and the guide only reaches
  conversations that need it;
- four mandatory fields (destination, dates, duration, travellers) plus useful ones, with
  ambiguity (inferences, contradictions, uncertain party size) modelled explicitly;
- observability and evaluation are **written designs**, not implemented;
- a fixed scope (§1–§14) and a prioritised backlog (§15), which the README's "Next steps"
  section links to instead of copying.

Positioning. Conversational booking assistants turn a conversation into a bookable basket;
itinerary generators produce a draft itinerary for the traveller to review. This agent produces something else: a brief the
traveller has validated and a local agency can use immediately, with mandatory fields enforced
by code, inferences and open points made explicit, sourced recommendations and responsible-travel
guidance. It takes the place of the quote request form; itinerary design stays with the agency.

Pattern: hybrid. An agentic loop (the model chooses its next action each turn) wrapped in
deterministic gates for what must not depend on the model's judgement: brief
readiness, guide prerequisites, catalogue coverage, source provenance, sending.

Project principles: production-grade foundation on a tight scope, proven maintained solutions
over custom code, every third-party API and config checked against official docs.

## 2. Decisions

| Topic | Decision | Main reason |
|---|---|---|
| App | Next.js 16 App Router, React, one stateless service | UI and streaming route handler in one unit `pnpm dev` serves; first-class AI SDK integration |
| Agent runtime + UI protocol | Vercel AI SDK 7 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`) | typed tool parts, client-side tools, native tool approval, provider abstraction |
| Model | `claude-sonnet-5-5`, `effort: "medium"`, refusal fallback `"default"` | see §2.1 |
| Web search | Tavily behind a custom tool, official domains for health and formalities | free tier, provider-neutral, domain filters and result trimming |
| Destinations | static catalogue of ISO 3166-1 alpha-2 codes with French names from Unicode CLDR 48.2.2 | a local agency specialises in one destination, so a brief must target a covered one; CLDR is the maintained reference for country codes and localised names |
| Brief shape | the fields a custom-trip quote request needs: destination, period, duration, travellers, then budget, rhythm, accommodation, guidance and wishes | an agency can decide whether it can answer from the four mandatory fields and personalise its proposal from the rest |
| Lazy instructions | `load_guide` tool reading `guides/<name>/SKILL.md`, enforced by prerequisite gates | progressive disclosure without a second runtime |
| Brief state | recomputed server-side from `update_trip_brief` **inputs** in the history | no database; client-sent outputs never trusted (§7) |
| Observability | written design only (Langfuse recommended there) | a prototype with no production traffic has nothing to trace yet; guide loading stays verifiable through the tests and the gates |
| Evaluation | written design only | the scenarios and the judge need calibration data a prototype does not have |
| CI/CD | GitHub Actions CI (lint, format check, typecheck, test, build) | standard production baseline on every push and pull request |
| Local run | `pnpm install && pnpm dev` with `.env.local` | one command; no container needed |
| Hosting | repository run locally, no hosted instance; Anthropic workspace spend limit + step and size caps | a hosted instance would need an access control and a rate limit first (§7) |
| Language and tone | French UI and agent, formal "vous"; code and docs in English | audience is French |
| Look | own palette (deep blue `#1e4d6b` for brand, secondary and focus ring, sand `#f6c26b` for the primary action), Inter and Fraunces, no logo; the prototype notice lives in the README and on the recap card | a calm, legible identity whose every text pair is checked against WCAG AA (§8) |

### 2.1 Model choice

`claude-sonnet-5-5` is a defensible default, not a proven optimum
([ADR 0008](../adr/0008-sonnet-5-5.md), which supersedes the `claude-sonnet-5` choice of
[ADR 0002](../adr/0002-model.md)). It keeps Sonnet 5's price ($2/$10 per MTok, cache reads $0.20),
tokenizer, 1M context and 128k output, with a 512-token cache minimum
([migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)).
Facts checked on 2026-09-17 for the Sonnet line: "Fast" latency class; strict tool use and
structured outputs are GA; cached input
tokens do not count toward input rate limits
([models overview](https://platform.claude.com/docs/en/about-claude/models/overview),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations),
[rate limits](https://platform.claude.com/docs/en/api/rate-limits)).

- `effort` defaults to `high` with adaptive thinking, and its levels are recalibrated on
  Sonnet 5.5; `medium` is the starting point for multistep tool use, which every turn here is, and
  `low` is the next level to test
  ([effort](https://platform.claude.com/docs/en/build-with-claude/effort)). It is fixed per
  deployment because changing the top-level effort between requests invalidates the cache.
- Thinking is adaptive by omission (`disabled` is rejected on Sonnet 5.5), `tool_choice` is only
  ever `auto` or `none` (forced `any`/`tool` is rejected), and non-default
  `temperature`/`top_p`/`top_k` are never set.
- `fallbacks: "default"` lets the API retry a refused request on another model for the
  categories it can route; a request that is not refused is unaffected.
- Opus 5 costs 2.5× more for a task dominated by dialogue and extraction. Haiku 4.5 is
  previous-generation: our ~3.5k-token static prefix is below its 4,096-token cache minimum,
  it has no `effort` control, and its retirement is only guaranteed until 2026-10-15.
- Other providers are credible: Gemini 3.8 Flash and Mistral Medium 3.5 are cheaper,
  GPT-5.6 Terra is at price parity
  ([OpenAI](https://developers.openai.com/api/docs/pricing),
  [Gemini](https://ai.google.dev/gemini-api/docs/pricing),
  [Mistral](https://mistral.ai/pricing/api)). EU processing is available from Mistral's dedicated
  `api.eu.mistral.ai` endpoint (`api.mistral.ai` routes globally) or from Claude on Vertex AI `eu`,
  and not from Anthropic's first-party API (`global`/`us` only,
  [data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)).
  Checked on 2026-09-17 against the current catalogues: Mistral Medium 3.5 would cost about 27 %
  less per conversation than Sonnet 5.5 and GLM 5.3 (served by Mistral, public preview) about 47 %
  less, but strict tool use has no documented equivalent outside Anthropic and a preview model
  carries a one-month deprecation notice, so the switch stays gated on the evaluation below.
- Reversibility: switching is a provider factory change; Anthropic-specific code is limited to
  cache breakpoints and `effort` provider options; search does not use a vendor server tool.
- We would switch if the evaluation (§10) shows another model at equal readiness accuracy and
  tool choice for materially lower cost or p95 latency, or if EU-only processing becomes
  mandatory.

### 2.2 Rejected alternatives

Checked on 2026-09-17; details and links in `docs/adr/`.

- **CopilotKit + LangGraph / DeepAgents** — native human-in-the-loop,
  shared state and skills. Rejected here: two services (UI runtime + LangGraph
  server), React API split between v1 and v2 entry points, AG-UI client packages at 0.0.x
  ([CopilotKit LangGraph quickstart](https://docs.copilotkit.ai/integrations/langgraph/quickstart),
  [DeepAgents skills](https://docs.langchain.com/oss/javascript/deepagents/skills)).
- **Claude Agent SDK** — native Skills and `AskUserQuestion`, but one CLI subprocess per
  session, no UI layer, long-lived containers with session affinity for multi-user hosting
  ([hosting](https://code.claude.com/docs/en/agent-sdk/hosting)).
- **Itinerary generation** — out of scope by design: the local agency builds the itinerary and
  the quote, and the agent's value is a brief the agency can act on.
- **Pure workflow (form-like state machine)** — a form is what the agent replaces; the agent
  decides when to ask, infer, move on and stop.
- **Anthropic server `web_search`** — native citations, but ties search to one provider and
  gives less control over result trimming; $10 per 1,000 searches
  ([web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)).

Porting map (ADR "portability"): `ask_traveler` → CopilotKit frontend human-in-the-loop;
`load_guide` → DeepAgents / Agent SDK skills; brief recomputed from history → LangGraph shared
state over AG-UI; model access → LiteLLM through an OpenAI-compatible provider (Anthropic cache
breakpoints then move to LiteLLM's `cache_control` settings).

## 3. Architecture

```mermaid
flowchart LR
  U[Traveller] --> UI
  subgraph Browser
    UI[Chat page · useChat]
    UI --> Q[Choice card]
    UI --> C[Destination card + map]
    UI --> R[Recap / approval card]
    UI --> P[Project panel]
  end
  UI -- UI messages --> API[/POST /api/chat/]
  API --> V{validateUIMessages · size caps}
  V --> F[recompute brief and card from inputs · rewrite guide outputs · prune old search results]
  F --> ST[streamText · claude-sonnet-5-5]
  ST <--> T1[search_web] --> TV[(Tavily)]
  ST <--> T2[load_guide] --> FS[(guides/*/SKILL.md)]
  ST <--> T3[update_trip_brief]
  ST <--> T4[show_destination_card]
  ST <--> T5[propose_quote_request]
  T3 & T4 & T5 --> GATE{{gates: readiness · guides · catalogue · provenance · family health}}
  GATE --- CAT[(destinations.json)]
  ST -. client tool .-> T6[ask_traveler] -.-> Q
```

Choice question round trip:

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

Recap, approval and simulated sending:

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as /api/chat
  participant M as Model
  M-->>S: propose_quote_request(briefVersion)
  S->>S: sendDenial: readiness · family guide · version match
  alt denied
    S-->>M: denial reason: what is missing, the guide, or the current version
  else user-approval
    S-->>B: approval requested + recap card
    alt "Envoyer"
      B->>S: approved
      S->>S: sendQuoteRequest re-runs the same sendDenial
      S-->>B: simulated Demande de devis (agency text + JSON), no model call
    else "Modifier"
      B->>S: denied, reason "modifier"
      M-->>B: "Qu'est-ce que vous souhaitez changer ?"
    else "Abandonner"
      B->>S: denied, reason "abandon"
      M-->>B: closes without sending
    end
  end
```

## 4. Tools

Six tools, each with a distinct contract: the Claude Certified Architect exam guide (Foundations,
task 2.3) warns that too many tools degrade selection (18 tools vs 4–5 in its example), and each tool here maps to one
required capability. Rich descriptions: input formats, when to use, when not to. Inputs are validated
with zod on the server even with strict tool use, because strict JSON Schema does not support
`minimum`/`maximum`/`minLength`/`maxLength` and limits `minItems` to 0 or 1
([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
Errors: `{ errorCategory: "validation" | "transient" | "business", isRetryable, message }`.
Parallel tool calls stay enabled (guide load and search can run together); only the first pending
`ask_traveler` is answered, the client closes extra ones with an error output ("Une seule
question à la fois").

| Tool | Runs | Contract |
|---|---|---|
| `ask_traveler` | client (no `execute`) | `question`, `options` (2–6, `{id, label, description?}`), `multiSelect`; output `{ selected: id[] }` or `{ freeText }` — free text is always accepted through the main input; its description lists the enumerable questions it serves (party type, month, duration, rhythm, project maturity, quote basis) and no longer which destination to keep, the cards carrying that choice themselves (§8) |
| `search_web` | server | `query`, `topic: "general" \| "health_formalities"`; `health_formalities` restricts results to official domains (France Diplomatie "Conseils aux voyageurs", Institut Pasteur, WHO); up to 5 `{title, url, domain, snippet, publishedDate?}`; snippets truncated; timeout 8 s; empty list is a valid result; failures are `transient` |
| `show_destination_card` | server | `destinationId` (catalogue ISO code), `region` (≤ 80), `why` (≤ 280), `bestPeriod` (≤ 80), `highlights[]` (≤ 3 × 100), `alerts[]`, `sources[{title,url}]`, `coordinates {lat,lng}`, `flightTimeFromParis` (≤ 40); `region` and `flightTimeFromParis` are required, being two of the three rows two cards of a turn align on (§8), and an optional one would make the two cards structurally uncomparable; sources must be http(s) URLs returned by a previous `search_web`; unknown destination id → rejected by input validation (catalogue enum); output `{ card }` is a declared schema, and one builder serves the live call and the history replay so the gates hold on both; the interface renders the card in one of two forms and the model chooses neither (§8) |
| `load_guide` | server | `guide: "family_travel" \| "responsible_travel"` → guide body read from disk |
| `update_trip_brief` | server | partial patch (§5) → `{ brief, version, missingForRecap[], requiredGuide? }` (alerts live in `brief.feasibilityAlerts`; their sources obey the same provenance rule as card sources — returned by `search_web` in this conversation) |
| `propose_quote_request` | server with tool approval | `briefVersion` (16-hex hash of the brief shown in the recap); gate `sendDenial` (readiness, family guide, version match), run by the approval callback and again by `sendQuoteRequest`, which the tool's `execute` and the closing turn (§6) share; approval UI = recap card; the simulated send happens after approval and ends the turn with no text after it; a denial with reason `modifier` returns to editing, `abandon` ends without sending and still gets a reply; output `{ brief, agencyText }` is a declared schema, so a forged output is a 400 and not a crash |

**Guide triggers and gates.** The `load_guide` description holds the trigger rules:
`family_travel` as soon as children, `partyType` family, or a family trip are mentioned;
`responsible_travel` before recommending destinations or when the traveller expresses a
responsible-travel wish (avoid crowds, off the beaten track). Deterministic prerequisites,
checked server-side against the history:

- family signals (a child recorded, or `partyType` = family) and no `family_travel` load → `show_destination_card` returns a `business` error and `propose_quote_request` approval is
  denied, both with "load family_travel first";
- no `responsible_travel` load → `show_destination_card` returns the same kind of error;
- family signals and no successful `search_web` with topic `health_formalities` whose query names
  the card's destination → `show_destination_card` returns a `business` error telling the model to
  run that search, naming the destination by its catalogue label. The family guide says to verify
  access to care, water quality and malaria or vaccines before recommending a destination, and a
  live run recommended the Canaries and Cap Vert to a family after searching only weather and
  flight times: guide text the model reads after loading it is followed some of the time, so the
  check is a gate. A health search for one destination does not cover another. The query is free
  text, so it is compared with the destination's catalogue label, and with that label's compact
  spelling (spaces and hyphens removed), after folding case, accents, hyphens and spaces
  (`String.prototype.normalize("NFD")` and the `\p{M}` property escape), as whole words —
  « Cap-Vert », « cap vert » and « CAP VERT » match `CV`, « Vietnam » matches `VN` through the
  compact form of « Viêt Nam », « Oman » does not match inside « romantique », and « Cabo Verde »
  does not match, which is what the refusal's wording is for. The two-letter ISO code is not
  compared: « in » or « es » would match ordinary words of a query. A successful search that returned no result counts: the gate asks for the
  search to have been run, and an empty list is what `search_web` returns when no official
  source matched. The searches are recorded by one function, `recordSearch`, called by the live
  tool and by both replays of a client-sent history, and a search counts only from the step after
  its own on all three paths: the AI SDK runs a step's tool calls together once the model call
  ends and a search records its results after its own `await`, so a card called alongside its
  health search is refused live, and the replays hold a search back until the next `step-start`
  part or the end of its message so they refuse it too. A replayed card is re-judged against the
  replayed searches and refused without one; a health search for another destination does not
  count. The `search_web` outputs are trusted as sent (ADR 0003), so a client can forge a health
  search into its own history and have its own card kept: the gate holds the model, not a client
  forging its own history.

No step is forced onto a tool: the agent fetches a guide when it needs one and decides its next
action turn by turn, and a `toolChoice` set by the harness would take that decision from it. The prompt and the tool descriptions say when to
load a guide and when to run the health search, `update_trip_brief` returns `requiredGuide`, and
each refusal names what to do next — the guide, or the topic and the destination of the search.
The gates above are the guarantee. The only `toolChoice` is `"none"` on the last allowed step,
the step cap ending the turn in text rather than a decision taken from the agent.

A loaded guide is added once as a tool result, when needed, and stays part of the conversation
from then on; the system prompt never contains it (a unit test asserts no guide text in the
system prompt). The interface says which guide is being read while it is being read, in the
status line, and says nothing about it afterwards: a badge announcing a loaded guide describes
the app rather than the voyage ([ADR 0007](../adr/0007-no-internals-in-the-interface.md)).

Both guides are written for the project. `guides/family_travel/SKILL.md` covers tone with
families, what to collect or check (each child's age, pace, health, accommodation, meals), the
signals to raise with tact and the defaults (direct flight, one base, a mild season).
`guides/responsible_travel/SKILL.md` covers the levers of a recommendation: off-season,
less-visited regions, longer stays (suggested, never imposed), closer destinations, low-carbon
transport on site, the local agency's expertise, community experiences, respect for cultures and
animal welfare. Wording rules: comparative claims only ("moins fréquenté"), no unsourced
emission or crowding figure, no guilt about long-haul travel.

**Destination catalogue.** `data/destinations.json` holds the 249 ISO 3166-1 alpha-2 codes with
their French names, generated by `scripts/extract_destinations.py` from Unicode CLDR 48.2.2
(`cldr-core/supplemental/codeMappings.json` for the codes, keeping numeric codes below 900 to
drop CLDR's own groupings such as `EU` or `ZZ`; `cldr-localenames-full/main/fr/territories.json`
for the names). Each entry has `id` (the ISO code, e.g. `VN`) and `label` (e.g. « Viêt Nam »,
« Cap-Vert »); there are no regional entries. It stands in for the agency network's coverage,
which a production deployment would read live.

Uncovered destination: a request on a destination no agency covers goes unanswered, and a
better-qualified brief removes that case before sending. When the traveller wants a destination
outside the catalogue, the agent says plainly that no local agency covers it and proposes two or three nearby catalogue destinations; the brief
cannot be sent on an uncovered destination.

## 5. Trip brief model

The fields a custom-trip quote request needs. Every field is wrapped as `{ value, status, evidence?, note? }`:

- `confirmed` — stated explicitly by the traveller, or approved in the recap;
- `inferred` — deduced by the agent ("on est 2" → 2 adults, "3 semaines" → 20–21 nights);
- unknown — the field is absent.

Mandatory:

| Field | Shape | Rule |
|---|---|---|
| `destination` | `{ destinationId, region?, combineWith? }` | one catalogue destination (the agency); `combineWith` is a nuance for the agency ("souhaite combiner avec le Cambodge"); asking "c'est où Zanzibar ?" only feeds the top-level `alternativesConsidered` |
| `dates` | `{ precision: "exact", start, end, flexibilityDays? }` (`YYYY-MM-DD`), `{ precision: "month", start, end? }` (`YYYY-MM`) or `{ precision: "season", season, year }` | a month or a month range is enough ("juillet ou août"); a season is recorded but not enough; family options may be school holidays mapped to months; the year is resolved against today's date, and a period whose end has already passed is refused |
| `duration` | `{ minNights, maxNights }` | must fit inside exact dates when both exist |
| `travelers` | `{ partyType: alone \| couple \| family \| friends \| group, adults, children: [{ age? }], groupType?, uncertainty?, quoteBasis? }` | `family` means travelling with minors, so it requires at least one child with an age; a party of adults is `couple`, `friends` or `group`. "4 ou 6": either resolved, or a chosen quote basis (`adults` = basis, `note` = "peut-être 6") |

Useful (never blocking):

| Field | Shape |
|---|---|
| `projectMaturity` | `inspiration \| planning \| bookingSoon`, rendered "Recherche d'idées" / "Préparation en cours" / "Réservation prochaine" |
| `budget` | `{ ideal?, max?, currency: "EUR", basis: "perPersonExcludingInternationalFlights" }`; a total is converted and marked inferred |
| `occasion` | e.g. honeymoon, birthday |
| `departureCountry` | residence or departure country |
| `rhythm` | `singleBase \| fewStops \| frequentMoves \| unknown` (1, 2–3, 4+ accommodations) |
| `accommodation`, `guidance` | free labels (level/type of stay; driver-guide, French-speaking guide, independent) |
| `interests[]`, `constraints[]` | wishes and constraints (mobility, diet, visa) |
| `alternativesConsidered[]` | destinations the traveller looked at without choosing them |
| `projectSummary` | the traveller's project in a few words, kept for the agency |

Cross-cutting: `contradictions[] { field, statements[], resolved }`,
`feasibilityAlerts[] { kind: budget \| season \| health \| pace \| coverage, message, sources[] }`.
`interests` and `constraints` are shown to the traveller in the panel and in the recap, not only
in the agency text.

Merge rules (pure function, one test per rule):

| Case | Rule |
|---|---|
| scalar field | patch replaces the value; `null` clears it |
| array field | patch replaces the array |
| explicit correction by the traveller ("finalement", "plutôt", "pas X mais Y") | the patch carries `resolves: field`; value replaced, no contradiction |
| a `confirmed` value replaced without `resolves` | contradiction opened automatically |
| `inferred` value replaced | no contradiction |
| recap approval | promotes every mandatory field to `confirmed`, in the state and not only in the tool result, so the history replay reproduces it on the next turn |

Gates (pure functions):

- `isReadyForRecap(brief, today)`: the four mandatory fields have a value; destination is in the
  catalogue; dates at least month-level and not entirely in the past; a family has at least one
  child and every child has an age;
  `travelers.uncertainty` is
  resolved or a `quoteBasis` is set; no unresolved contradiction. Inferred values are allowed:
  the recap is where the traveller validates them.
- `isReadyToSend(brief, today, approval)`: `isReadyForRecap` and the approval refers to the hash of
  this exact brief version.

`datesPast` is the dates half of the first gate, and it blocks the recap like every other
`MissingItem`: the end of the range decides, so an exact range already under way is still
sendable while a month or a season gone by is not, and `blockedFields` points it at the `dates`
row. The comparison is a lexicographic one on the ISO value each variant already carries
(RFC 3339 §5.1 orders ISO 8601 that way), so no variant is parsed out of free text and no date
library is needed. The clock is a parameter, as it is for `renderAgencyText`, and is threaded
from the route through `deriveConversationState`, `applyPatch` and `sendDenial`: a gate that read
the clock itself could not be tested without mocking time, and the deterministic gates are the
architecture's whole argument. An agency receiving a quote request for a month already gone is
the non-actionable demande the product exists to prevent, and a live run produced exactly that —
"deux semaines en février" recorded as 2026-02 on 2026-09-21, four fields complete, nothing
blocking the send. The date was already pinned on the first user turn, so a rule the model can
get wrong is replaced by a gate it cannot.

Budget alerts are indicative ("à ajuster avec l'agence"), based on search results; production
would use the agencies' own minimum-budget rules.

Agency-readable rendering (deterministic French text), in this order: one-line header (who,
where, when, how long, budget); points of attention (feasibility alerts, constraints, near
departure); what the traveller has not settled; wishes and nuances (3–5 bullets with short
quotes); project summary; project maturity. No per-field status or evidence in this text; the
JSON keeps them.

## 6. System prompt and conversation policy

French, formal "vous", stable, cached (breakpoints on the system prompt and on the latest
message). Today's date is added to the **first** user turn, not the latest: the ephemeral cache
lives for minutes, so what has to stay identical is the prefix from one turn to the next within a
conversation, and a note that moves rewrites the middle of the history and voids the entry written
at the previous turn. The reusable prefix is still cut short when the oldest `search_web` call ages
out of the six-message pruning window; bounded context is worth that, and the effect shows up in
the cache-read ratio tracked in [`docs/observability.md`](../observability.md).

Contents:

- role and limits: brief only, never prices, availability or itineraries; no commitment made on
  behalf of the agency — no response time, no satisfaction figure, no label, no
  guarantee, none of which a prototype could honour or source; explain simply that a local
  agency specialises in one destination;
- style: formal "vous", present indicative, short sentences often in two beats, at most ~80
  words outside cards; the traveller's situation in the second person and the actions offered
  to them in the imperative, since the model writes its own prose and would otherwise undo the
  interface's register at the next turn; the vocabulary of the interface (voyage sur mesure,
  agence locale, itinéraire, étapes, envies, destination, période) and never "projet" for a
  trip, nor "brief" — the prompt's own internal word for the structured state, `update_trip_brief`
  included, which a live run had the model say to the traveller ("Le brief est complet") though
  the interface itself never uses it, reading "votre voyage" and "votre demande" instead, so the
  rule now names those two replacements; no stacked superlative, no exclamation mark, no emoji;
- desire, deliberately reopened: the bans above killed the chatty filler and, with it, every
  reason to want to go. What makes a traveller want to go is one concrete situated detail —
  something seen, heard or smelled, at a given hour in a given place — not a pile of adjectives,
  so the prompt asks for exactly one and carries three examples, the model copying an example
  more reliably than a rule. It lands in `why`, the destination card's 280 characters: the detail
  first, then why this destination suits this traveller. One such detail per message, only around
  a card or a recommendation; questions, the recap, health and formalities stay factual. The bans
  are unchanged — the register is evocative, never breathless;
- per-turn policy, in order: record, then decide. `update_trip_brief` is called first whenever
  the traveller's message carries anything about the voyage — before searching, recommending or
  asking the next question — and only then does the turn choose between answering, asking,
  searching and illustrating. It used to be listed as neither: the four actions were the menu and
  the rule mandating the call sat two sections below, under Brief, where it read as bookkeeping,
  and a live run went three turns with a destination, a month, a party size and a budget given
  and nothing recorded. The section is named for both steps and a unit test asserts the order;
- collection order: destination, dates, travellers first, accepting vagueness; clarify before
  proposing, without a stream of questions;
- choice question when options are enumerable (party type, month, rhythm, maturity), open
  question for wishes and children's ages; one question at a time; never re-ask a confirmed
  value; every personal question says why it is asked;
- advice questions: answer first (with search), then invite once to prepare the trip;
- infer on strong signals and mark as inferred; an explicit correction is a resolution; when two
  statements coexist without a correction marker, record the second and then ask which to keep.
  The order matters: `mergeBrief` is what opens the contradiction, keeping the confirmed value
  and storing both statements unresolved, so a conflict the model only asks about is a conflict
  nothing holds. A traveller who declines to choose leaves it open, which is the intended
  outcome — `openContradiction` stays in `missingForRecap`, the panel names it and the recap is
  blocked — so the prompt says to leave it there and raise it again at the conclusion rather
  than every turn;
- search whenever an answer depends on facts; health and formalities use the official-domain
  topic and always end with a referral to a doctor or an international vaccination centre;
  for a family, a health search per destination, with that topic and naming the destination,
  comes before any card of that destination — the prompt says so up front, and §4's gate holds
  it when the model does not;
  say plainly when something could not be verified; retry a failed search at most once, then
  answer in text without a card;
- a period already passed is refused and blocks the recap, and a month already gone by this year
  means next year — "février" in September 2026 records as 2027-02. The rule sits beside the
  other Brief rules and states what the gate does, the prompt's job being to keep the model from
  walking into it;
- after two destination cards, ask nothing: the cards carry the choice, each one holding the
  button that sends "Je retiens {label}" (§8), and a question below them would ask it twice. The
  prose beside a pair introduces the comparison and stops there: the model obeyed the ban on
  `ask_traveler` and then asked the same question in prose under the cards, so the rule now
  covers prose as well and carries the correct text with the sentence not to write;
- budget: ask once, skippable; alerts phrased "à ajuster avec l'agence", never "irréaliste";
- family guide attentions (rhythm, accommodation, food) are recorded when mentioned, otherwise
  grouped into one multi-select card; health details only when the traveller brings them up;
- when to stop: once `isReadyForRecap` holds, at most one more useful question (never when the
  traveller gave everything upfront), then the recap. That question is budget or wishes, unless
  the family guide is loaded and its attention points (rhythm, accommodation, food) have not come
  up, in which case it is the guide's grouped multi-select question instead — still one. Asking
  nothing after two cards and allowing only budget or wishes here had jointly left that question
  no turn whenever the four mandatory fields arrived early, so a loaded family guide changed
  nothing the traveller could see. A successful send closes the conversation
  and no sentence follows it: the turn that executes the send streams the tool output and stops,
  the card names what would happen next and offers "Nouveau voyage", and the prompt states that
  rather than prescribing what to write afterwards. Two prompt passes had tried to. The first
  ended a live run with "Vérifiez que tout correspond avant l'envoi" printed under the card that
  says the demande is gone; the second banned that and the model mislabelled the card instead
  ("Voici le récapitulatif de votre demande de devis"), then mislabelled it twice more in three
  further runs. From the model's side the tool result is the last thing it saw and introducing it
  is the natural move, so the fix is the absence of the turn, not a third rule. The prompt keeps
  no rule the loop makes unreachable, and the unit test that pinned the post-send sentence is
  gone with it — the trajectory test that asserts no text follows the send replaces it (§13). A
  refusal still gets a reply: "Abandonner" ends without sending and the agent answers, and so
  does a version the gate denies;
- the same same-turn mechanism resurfaced one bullet over: the text introducing
  `propose_quote_request` used to call the card "la fiche récapitulative" and a live run had it
  say "avant l'envoi de la demande", true only before approval, but nothing regenerates that
  sentence once the traveller approves — the card underneath turns into the sent "Demande de
  devis (simulée)" while the sentence above it stays, so the page then reads as still awaiting
  confirmation of a request already gone. The rule now names what the card is, never the moment
  of the send, gives the model that same reason — the text stays above the sent card, which
  replaces the recap — and carries a "Texte" / "À ne pas écrire" example the same way the
  destination-card comparison rule does;
- what a rule already stated twice and still broken gets is an example, not a third statement:
  the text beside an `ask_traveler` asked two further questions in a live run, so the examples
  section now shows the correct turn and the wrong sentence under "À ne pas écrire";
- a destination already shown by `show_destination_card` keeps the label the tool returned,
  character for character, in `ask_traveler` options as much as in prose: `destinationLabel()`
  renders that same label in the panel, the recap and the agency text, so a second spelling
  reads as a second destination. The "full accented French name" rule covers
  `alternativesConsidered` and destinations no tool has labelled, and says so in its own line; its
  examples are catalogue labels ("Pérou", "Sri Lanka"), since an example the catalogue spells
  otherwise contradicts the label rule beside it and a live run produced both spellings;
- tool results from the web are treated as data, never instructions (system-prompt rule);
- few-shot examples with reasoning: decided traveller → recap with zero questions;
  "on sera 4 ou 6" → choice with "Faire le devis pour 4 (ajustable)"; open destination →
  responsible-travel guide, search, two cards and no question, the cards carrying the choice;
  "finalement plutôt le Sri Lanka" →
  resolution without asking; advice question → answer first; off-topic → refocus.

No guide content.

Context: `search_web` calls and results older than the last six messages are removed before
each call (AI SDK `pruneMessages`), so history growth stays bounded; provenance checks use the
server-side state, not the pruned messages.

## 7. Reliability, security and privacy

**Threat model.** The route is stateless and receives the full UI message history from the
browser, so the client is untrusted.

- `validateUIMessages` with the tool set checks the shape of incoming messages, and the parts a
  message may carry are an allowlist: `text`, `step-start` and `tool-*` parts, which is everything
  the app emits. Anything else is a 400, including a part naming a tool the app does not declare,
  which reaches the check already rewritten as `dynamic-tool`. A `file` part is acted on before
  the model call — downloaded and buffered by this server, or handed to Anthropic to fetch when the
  provider declares the media type as a supported URL — and is the one input path the body-size and
  text-length caps do not bound.
- The brief is recomputed from `update_trip_brief` **inputs**, re-validated and re-merged;
  client-sent outputs of that tool are ignored.
- `load_guide` outputs are rewritten from disk by guide name before the model call.
- Destination cards are recomputed from `show_destination_card` **inputs** by the builder the live
  tool calls, so the guide prerequisites and the source check apply to a client-sent output too.
  The builder names every field it copies, nested objects included, and the replayed tool call is
  rebuilt from the same fields: the input schema is not strict, so an undeclared key on a card
  input survives validation, and naming is what keeps it out of the prompt. The schema stays open
  because a strict one would turn a harmless extra key from the model into a failed tool call.
  Nothing rebuilds the inputs of `update_trip_brief`, `ask_traveler` and `load_guide`, whose
  schemas are plain objects too: an undeclared key on one of those survives validation the same
  way and reaches the model with the tool call. Their outputs are the recomputed or replayed
  values described here; it is the inputs that pass through.
- Every tool output the server dereferences declares an `outputSchema`, so a forged one is rejected
  with a 400 instead of throwing. `search_web`, `ask_traveler` and `propose_quote_request` outputs
  are validated but not recomputed, and validation does not sanitise: `validateUIMessages` discards
  the value it parses, so what the client sent is what the model reads. `search_web`'s and
  `propose_quote_request`'s schemas are strict and cap every string they declare — the search hit
  at what the live path already produces, which re-checks each mapped hit against that same schema
  so the two cannot drift, and a tool error's `message` at 2 000 characters, truncated to that
  same bound by `toolFailure`, the one helper every failure is built with. Declaring the cap alone
  would not hold: a message interpolates values no schema bounds — an invalid-sources list carries
  up to five URLs — and a card output is validated again on the next turn, so a business failure
  that overran its own schema would come back as a 400. Two things they do not bound:
  `ask_traveler`'s schema, which is neither strict nor capped, and the URLs of a brief's
  `feasibilityAlerts[].sources`, `z.httpUrl()` with no length of its own, up to five per alert
  and ten alerts. No schema rejects an unknown key nested inside a shared object either, a tool
  error and the brief among them. The reach is the forging client's own session — the brief an
  agency would read is rebuilt by the same walk, and the send stays gated by `sendDenial`.
- Reasoning is not streamed to the client (`sendReasoning: false`): nothing renders it, and the
  browser is untrusted.
- Source provenance, for a card's sources and a feasibility alert's sources alike: an http(s) URL
  returned by `search_web` in the same conversation. `search_web` outputs are
  themselves client-sent, so a forged search result can at most make a card cite a forged URL in
  the attacker's own session.
- Sending is simulated and gated server-side by `sendDenial` — readiness, the family guide and the
  version match — plus the approval mechanism. The SDK states the residual threat of that
  mechanism: approvals reconstructed from a client-controlled history are re-validated against the
  tool schema and the policy, but "a client that crafts a valid-looking approval for a
  schema-conforming input can bypass the human-in-the-loop step", and it offers
  `experimental_toolApprovalSecret` to bind approvals cryptographically to the server that issued
  them ([tool approvals](https://ai-sdk.dev/docs/agents/tool-approvals)). The secret is not used
  here because the state a forged approval would act on is itself rebuilt from tool inputs and the
  approved `briefVersion` has to match the version the server recomputes: a forgery can skip the
  traveller's click on a brief the server already considers ready, but it cannot send one that is
  incomplete, stale, or missing its family guide. That is acceptable while sending is simulated; a
  real send to an agency would need the signed approval, and it is listed with that
  item in the backlog.
- Caps: request body size, message length, number of messages, 10 steps per turn (sized for
  guide + three searches + three cards); reaching the cap produces a French fallback message,
  not a raw error.
- Production target (documented, not built): persist messages per `chatId` server-side and
  accept only the latest message, following the AI SDK persistence pattern.

**Least privilege.** No tool has an external side effect; the only "action" is the simulated
send, behind human approval.

**Exposure.** The app runs locally from the repository and authenticates nobody; `pnpm dev` and
`pnpm start` both bind `127.0.0.1`. No per-IP rate
limiting; the Anthropic spend limit is the backstop. Hosting it would need an access control and
a rate limit added first.

**Privacy (GDPR).** The agent asks for no identity data, but travellers may volunteer health
or mobility information, which is special-category data. The interface carries no line asking
travellers not to share sensitive personal details; the README does. No conversation is logged
or sent to a third party other than the model and search providers; production tracing
requirements (EU region, masking, retention) are in `docs/observability.md`. The agency text keeps only what the agency needs (minimisation). Model inference goes to
Anthropic's first-party API (`global` processing); the README says so and lists EU processing
as a production requirement.

**Prototype notice.** The app is named "Assistant voyage sur mesure"; the recap card labels
sending as simulated ("Prototype : l'envoi est simulé"); pages are `noindex`. The three facts a
reader needs — nothing is sent, a reload ends the conversation because nothing is persisted, and
messages reach the model and the search provider — are stated by the README and
`docs/architecture.md`, which is where someone running the prototype from its repository reads
first, not by a line under the input.

**Latency targets** (to measure): first visible feedback under 1 s (status line), first token
p95 under 4 s, recommendation turn (guide + searches + cards) p95 under 25 s.

## 8. UX

- Welcome message saying what the assistant does — "Décrivez-moi votre envie, même vague. J'en
  fais la demande de voyage sur mesure qu'une agence locale recevra." — with four suggestions.
  Clicking one sends its label as the traveller's first message, so each label stays in the first
  person, being what a traveller would type: "Je ne sais pas encore où partir", "J'ai une
  destination en tête", "J'hésite entre plusieurs destinations", "Je pars en famille". The hint
  under each one is where the assistant answers, and the four are parallel — one present-tense
  sentence in the assistant's own voice, announcing the first step.
- Status line: a pending label before the first token, then per tool, naming what is being done
  rather than only that something is — the query being searched, the guide being read — once that
  input is settled; a still-streaming input keeps the generic per-tool label instead of growing
  character by character in the `role="status"` region. It stays visible between a tool returning
  and the next step's first token, and gives way only once text is actually flowing. A recap
  awaiting approval is announced by name, not folded into the generic "reply received" line.
- Streaming markdown; `aria-busy` while streaming, completed messages announced once.
- Choice card: native radio/checkbox inputs, keyboard accessible, announced as a new question;
  once answered it turns into a read-only summary ("Votre réponse : …"); typing in the main
  input answers it. Which destination to keep is no longer one of its uses — that choice lives in
  the destination cards — and it still serves party type, month, duration, rhythm, project
  maturity and the quote basis.
- Focus never falls to `<body>`. Every control that destroys itself hands focus to the composer,
  the one control that is always present and where the traveller acts next, and it hands it over
  *before* the state change rather than after: `focusComposer()` moves focus while the doomed
  control is still mounted, so the unmount has nothing left to take. A deferred pass was not
  enough — a browser run measured `document.activeElement` as `BODY` after "Nouveau voyage"
  inside a sent brief, `useChat` committing its own store update so the transcript can unmount
  after the frame rather than before it. Cases: answering a choice
  card or responding to the recap replaces it with a read-only summary, "Nouveau voyage" empties
  the transcript, and "Voir le récapitulatif" disables itself on click — a disabled element is
  not focusable — then unmounts when the recap arrives. The header's "Nouveau voyage" goes
  through a confirm dialog, where a call before the reset cannot hold: the open dialog traps
  focus and takes it back, then Radix restores it on close to the trigger the reset has just
  unmounted. The dialog content handles Radix's documented `onCloseAutoFocus` instead —
  `preventDefault()`, then `focusComposer()` — and does so on cancel and Escape too, where the
  traveller carries on writing, so the composer is where they act next. On mobile "Voir le
  récapitulatif" sits in a `SheetClose`, and the same handler runs: `focusComposer()` moves focus
  first, then Radix's restore on close returns it to the sheet trigger, the element that opened
  the sheet. Both stay mounted, so focus cannot fall to `<body>`, and the order is fixed rather
  than raced — FocusScope restores in a `setTimeout` after the unmount. One control hands focus
  over without destroying itself: « Je retiens
  {label} » stays live in its card, so there is no unmount to race and no SC 2.4.3 risk, and
  `focusComposer()` runs after the send for the other reason — the transcript auto-scrolls to the
  new turn, and a focused button left behind would be scrolled out of view (SC 2.4.11).
- The transcript is a scroll container, and a turn of plain prose holds nothing focusable now
  that sources are collapsed, so it is reachable with `tabIndex` and named "Conversation"
  (SC 2.1.1). The name needs a role to sit on: `aria-label` is prohibited on an element whose
  role is `generic`, and `tabindex` does not change an implicit role, so the element is a
  `role="region"` — the treatment the sent brief's JSON block already gets. Not `role="log"`:
  a live region there would re-announce every streamed token. The attributes go on the content
  element rather than the scroller, which `use-stick-to-bottom` renders itself and which takes
  a `scrollClassName` and nothing else — no `tabIndex`, no `aria-*`; a focusable child is what
  lets the arrow keys scroll it.
- A turn whose parts all render nothing — an `update_trip_brief` patch opening no new alert, a
  `load_guide`, a step boundary — renders nothing at all, speaker prefix included. The parts are
  rendered before the wrapper is, so the test is the switch's own result rather than a second
  list of which part types are invisible.
- Sources as links with their domain under the message or card that uses them. A `search_web`
  call renders where it happened, as a collapsed « N sources consultées · requête » disclosure
  — a turn holds several and the count alone does not tell them apart — and a failed one says
  so at that same position: the part always precedes the cards and buttons it feeds, so reading
  order follows from the transcript rather than from a rule. A destination card and a
  feasibility alert each carry their own cited sources. The card's sit behind that same
  disclosure, named after the destination, rather than open two elements below a collapsed
  one; an alert's stay inline, being the reason to trust a three-line callout.
- Feasibility alerts as a distinct callout in the conversation and in the project panel.
- Destination card, six blocks in one order: the title, a fact spine, `why`, the highlights, the
  alerts, and a footer carrying the disclosures behind a hairline. The title is the `label` the
  tool returned and nothing else — the same string the choice button and §6's prose reuse — and
  `region` moved out of it into the spine, three labelled rows ("Quand partir", "Vol depuis
  Paris", "Région") written in the `<dl>` pattern the project panel and the recap already use, so
  the three surfaces speak one visual language. The card's sources sit behind the disclosure
  above; the map sits behind a closed "Situer sur la carte" one with its attribution, so no tile
  is fetched unless it is asked for.
- The card has two forms and the model chooses neither: one card in a turn renders solo, two or
  three render side by side. Side by side, the columns share one row grid
  (`grid-template-rows: subgrid`), so the two titles, the two spines and the two "À savoir" blocks
  sit on the same baselines and the eye crosses between them, and opening a disclosure in one
  column grows only the last row. Side by side the card carries a seventh block, a `CardFooter`
  under the disclosures holding « Je retiens {label} »: the comparison is where the decision is
  made, and the order keeps it last so "À savoir" is read before anything is committed. The button
  sends "Je retiens {label}" as the traveller's own message, through the path the welcome
  suggestions already use, with its label built from the same `label` the title shows — the
  destination is named once. First person, the register the welcome suggestions above already fix
  for a label that becomes the traveller's message, and "Je retiens X" needs no article, where
  "Choisir le Cap Vert" would mean deriving *le* / *l'* / *la* per destination. The label wraps
  rather than keeping the button's own `nowrap`: the catalogue's longest is "Géorgie du
  Sud-et-les Îles Sandwich du Sud", more than twice the 314px column, and the card clips its overflow; both footers
  being one subgrid row, a label on two lines grows both columns and the buttons stay aligned. The buttons stay live after
  a click: clicking the other one sends a second message, which §6 already treats as an explicit
  correction. Under the two columns, one line — "Vous pouvez aussi répondre avec vos propres
  mots.", the sentence the choice card already carries — because two buttons otherwise read as an
  exhaustive choice. The solo card keeps its six blocks: a "choose this" button on a single card
  asks the traveller to pick from one. All seven blocks therefore render unconditionally: a card
  with no alert reads "Pas de point d'attention relevé." rather than leaving the row blank, which
  would read as missing data and would shift every block below it out of correspondence with the
  other column. The switch is a container query at 40rem on the cards' own container, not a viewport
  breakpoint — the transcript column is capped at 42rem but shares a grid with the 21rem panel
  from `lg` up, so it is 552px at viewport 1024 and 672px at 1144, and a breakpoint would go
  two-up exactly where the column is narrowest. Below 40rem the cards stack, still in comparison
  styling. Where subgrid is unsupported the declaration is ignored and the cards simply stop
  aligning.
- The question the two cards answer is a visible heading on the group — "Laquelle retenez-vous ?",
  the `<ul>`'s `aria-labelledby` — and not the model's prose: a group of controls must not be
  named by generated copy, and an invisible label would leave sighted travellers with two buttons
  and nothing asking anything. It replaces the group's previous `aria-label`. Consequence: in the
  comparison form the card title drops from `h3` to `h4` and "À savoir" from `h4` to `h5`, so the
  outline reads question → destination → its blocks; the solo card, which has no group heading
  above it, keeps `h3` and `h4`.
- The comparison form does not render the map: an embed is 177px of a 314px column, and §15 P2
  records that the model-supplied `coordinates` are one element of a card that can be silently
  wrong, which the moment of deciding is the worst place to show twice. The "Région" row answers
  "where is this" there, and the solo card keeps the map for projection. A horizontal scroller
  stays rejected — it would fight the transcript's own vertical auto-scroll and hide a card
  carrying an alert — and this is a grid and one disclosure instead. The card body is `text-sm`,
  the default every other card in the app already uses, which is what holds a 330px column at ~46
  characters per line and a 314px one at ~40, and `why` is capped at 280 characters, `highlights`
  at three and the paragraph at 68ch. That puts a solo card near 490px and a pair near 713px at
  the 672px column — the seventh block adds 73px: a 1px hairline, 2 × 16px of `--card-spacing`,
  a one-line 44px button and the 12px row gap, less the 16px bottom padding a footer replaces, and
  a label that wraps adds its second line to both columns — against
  1 186px for the same two cards stacked, with the comparison completing
  in the top ~230px — title, spine and gaps — so however long the alerts run, the content the
  choice depends on stays in one screen. Every figure here is computed from the tokens; §13
  carries the check that turns them into measurements.
- A card's alerts are a labelled list, not `Alert` primitives: an "À savoir" heading carrying one
  warning icon, then the alerts as a `list-disc` in `--warning-foreground`, 6.39:1 on the card.
  Three boxed alerts inside a card were a box inside a box inside a box, and the recap card
  already treats the same content this way. `role="note"` moves to the `<ul>`, and the severity is
  carried by the icon and the label as well as the colour (SC 1.4.1). Nothing is truncated or
  hidden: every alert still renders in full.
- Project panel ("Votre voyage"): a mirror of what the agent understood, never a second way to
  act on it. A mandatory field that holds a value shows it with a "Vous l'avez dit" or
  "À vérifier" badge beside it; one that does not reads "À préciser" as its value, and carries no
  badge. Then useful fields; the traveller's stated style (`interests`) and `constraints`, which
  an agency needs to personalise an itinerary; feasibility alerts with their
  sources. Nothing about how the app works: the guide chips that used to sit above the fields are
  gone ([ADR 0007](../adr/0007-no-internals-in-the-interface.md)). Progress
  counts the mandatory fields the server does not report as missing, not those that merely hold a
  value, and the header names what is still missing; once nothing is, it concludes — "Les quatre
  informations nécessaires à la demande de devis sont réunies." — rather than reading back a
  score the traveller cannot act on. The date field is labelled "Période", the word the empty
  panel, the missing-field list and the prompt all use: it accepts a month, a month range or a
  season, and "Dates" was the one place that promised something narrower. A period whose end has
  passed leaves that row uncounted and the header asking for "une période à venir", which names
  what the traveller can give rather than what they got wrong. A correction is made
  by saying so in the conversation, which the panel states in one line; there are no edit
  controls. Once a demande is sent, the panel reads the brief of the send's own output
  (`panelBrief`), in which approving the recap has confirmed the four mandatory fields, and not
  the last `update_trip_brief` output, which predates the approval and would leave "À vérifier"
  beside a field the sent JSON calls confirmed. The budget and the other optional fields keep
  their status: only the four mandatory ones are promoted. The composer stays enabled after a
  send, so a correction typed afterwards is a newer `update_trip_brief` output, and the panel
  reads whichever of the two comes last, which keeps it in step with the missing items the recap
  button reads from that later update.
- The panel is on screen from the first turn, before anything has been understood: the grid
  reserves its column, so hiding it would widen nothing and leave a quarter of the screen blank.
  Empty, it names the fields it is waiting for — "Je note ici ce que vous me dites. Destination,
  période, durée, voyageurs : les quatre informations nécessaires à la demande de devis." — where
  it used to score "0 information sur les 4" before the traveller had spoken. The four
  "À préciser" rows are what that sentence promises and stay; so does the progress bar, which is
  `aria-hidden`.
- When nothing is missing, the panel offers "Voir le récapitulatif". It sends a message rather
  than the brief: the agent is asked to propose, so the recap card stays the one place the
  traveller reviews what an agency would receive. It is hidden again while a recap is on screen
  and once a brief has been sent. On mobile, a badge opens a drawer carrying the same body: it
  reads "Votre voyage" until the agent has understood something, then "Votre voyage 2/4" — a
  count only once there is something to count. Its visible text is the head of its accessible
  name, which adds what is still missing.
- Recap card, titled "Récapitulatif de votre demande" after the button that opens it and the status
  line that announces it — "Demande de devis" names the sent artefact and nothing else:
  agency-readable summary with inferred values highlighted "À vérifier" and a description that
  says what "Envoyer" does to them — "Vérifiez-les : envoyer la demande confirme la destination,
  la période, la durée et les voyageurs." — where it used to say "Corrigez-les avant d'envoyer"
  above an enabled "Envoyer" that confirmed them; year and budget basis written out
  ("4 000 € par personne hors vols internationaux", the row label already saying "Budget"), "Points à
  vérifier avec l'agence"; buttons "Envoyer", "Modifier" and "Abandonner". After sending: "En
  conditions réelles, une agence locale de la destination reprendrait cette demande pour vous
  répondre. Ici, rien n'a été envoyé" — what happens next, without a response time a prototype
  could neither honour nor source — then the
  agency text, the JSON behind a "Détail technique (JSON)" disclosure, and a "Nouveau voyage"
  button.
- "Nouveau voyage", visible as soon as the conversation has started, and again on the sent card;
  reloading the page clears the conversation (stateless choice), which the README states — the
  interface carries no notice under the input.
- Errors: rate limit or overload, step cap, search unavailable — each with a French message and
  a retry button when relevant.
- Contrast, on the tokens in `app/globals.css`: no text pair falls below 4.5:1 (SC 1.4.3) and
  every boundary or state a control depends on reaches 3:1 (SC 1.4.11). The sand `--primary`
  is 1.63:1 on white, so a default-variant button draws a `--secondary` edge. That rule is keyed
  on `data-variant` alone, because Radix's Slot lets an `asChild` child overwrite `data-slot`,
  and it lives in the utilities layer so the Button's own `border-transparent` does not win. On
  focus a default-variant button takes an opaque `--ring` (9:1) rather than the half-alpha halo
  that resolves to 2.54:1 — its border cannot signal focus, `--secondary` and `--ring` being the
  same hex. So does `ghost`, the variant every disclosure trigger and "Nouveau voyage" use: a
  ghost button has no fill and no resting edge, so apart from the 1px `focus-visible:border-ring`
  edge that same 2.54:1 halo was all a keyboard user got around it. The opaque ring is the
  variant's own `focus-visible:ring-ring` in `components/ui/button.tsx`, the shadcn model where
  the project owns the component file, and `cn` merges it over the base `focus-visible:ring-ring/50`
  as tailwind-merge would; a global selector would also have reached any `asChild` consumer that
  carries the attribute.
  A checked checkbox or radio keeps a `--secondary` border instead of turning border and fill
  sand at 1.45:1 on a selected row. The page floor is `--canvas`, never `--accent`, which the
  token's own comment rejects at 1.13:1 on white. The panel's progress bar borrows `--input`,
  the form-control boundary token, for its unfilled segments: `#7a8c9a` on the panel's `#ffffff`
  is 3.47:1 where `--canvas` and `--border` are 1.24:1 and 1.29:1 and the track disappears. The
  filled `--secondary` against that track is 2.6:1, under the floor, which the bar is allowed
  because it is `aria-hidden` and the count is stated in text directly above it.
- Dark mode is not built and is out of scope. `@custom-variant dark` is declared,
  `color-scheme: light` is pinned and nothing ever adds `.dark`, so the `dark:` utilities carried
  in from shadcn are unreachable rather than a second theme. A dark palette would be eight new
  pairs to compute and verify, which is a surface of its own, not an accessibility fix.
- Screen-reader semantics. A turn's speaker is carried by alignment and tint alone, so each one
  opens with an `sr-only` prefix ("Vous : ", "Assistant : "). `role="alert"` is reserved for the
  transport error; a feasibility alert rendered as card or panel content is `role="note"`, since
  an assertive region for static content interrupts whatever is being read on arrival. Every card
  title is a real heading, the question included. A source link carries its publisher inside the
  anchor, so a links list names who published what, and the anchor is at least 24px tall.
  The interface is French throughout, the generated primitives included.
- French formats for dates and amounts.

## 9. Observability (design written in `docs/observability.md`, not implemented)

Proposed setup: Langfuse (open source, self-hostable or EU cloud, native session, token, cost
and prompt-version tracking) through its official AI SDK OpenTelemetry integration, one session per conversation, spans per step and per tool (one span per guide
load), token usage including cache reads; EU region, short retention, `evidence`,
`constraints` and `projectSummary` masked.

| Area | Signal | Why |
|---|---|---|
| Funnel | briefs sent per conversation started (against the quote form's completion rate), turns to `isReadyForRecap`, drop-off turn, recap approval and "Modifier" rates | abandonment before a request is sent |
| Brief quality | completeness at send, inferred values corrected at recap per field, contradictions opened/resolved, uncovered destinations proposed | requests an agency cannot answer |
| Maturity | distribution of `projectMaturity` at send | requests that never turn into a trip |
| Agent behaviour | tool-call distribution, choice cards vs free text answers, re-asked confirmed fields, questions per conversation, guide load when family signals exist, gate rejections by type | loops, over-questioning, missed guides |
| Grounding | factual answers preceded by a search, cards rejected for unknown sources, "could not verify" rate | hallucination risk |
| Reliability | tool errors by category, schema failures, provider 429/529, step-cap hits | structured-output and tool-call failures |
| Cost and latency | cost per conversation and per brief sent, cache read ratio, first token and turn duration p50/p95 | viability at several thousand conversations per month |
| Downstream (production) | agency response and refusal reasons, traveller follow-up, bookings | whether a better brief gets answered and booked |
| Safety | off-topic and injection-like inputs | abuse and prompt injection |

Alerting examples: cost per brief drift, tool error spike, cache read ratio drop, guide-load
miss rate above zero, latency p95 above target.

## 10. Evaluation (design written in `docs/evaluation.md`, not implemented)

Priorities:

1. Readiness decision: precision and recall of "ready to send" — a false positive costs the
   agency, a false negative loses the traveller.
2. Per-field extraction accuracy, stratified by intent and ambiguity type.
3. Tool choice per turn, guide triggering, catalogue coverage of recommendations.
4. Grounding: factual claims backed by retrieved sources, health answers from official domains.
5. Conversation efficiency: questions asked, re-asked values, turns to recap, zero questions for
   decided travellers.
6. Tone and French quality, family tone when the guide applies, no absolute eco-claims.

Ground truth: agency responses and refusals on historical Demandes de devis (or a review by an
agency) label what "sufficient" means; a small hand-labelled set calibrates the LLM judge.

Method: scenarios covering five entry intents (open destination, decided traveller, feasibility
question, vague wish, responsible-travel opener) plus "4 ou 6",
contradiction and correction, family trigger, responsible request, uncovered destination,
health question, off-topic and injection attempt; a simulated traveller for multi-turn runs;
deterministic assertions on tool calls and the final brief; an LLM judge from another
provider; at least three runs per scenario; offline runs on every prompt or model change as a
migration gate (promptfoo would fit); online sampling of production traces for human review.

Model comparison: Sonnet 5.5 at `low` and `medium` effort against Mistral Medium 3.5 on the same
scenarios; decision rule written in advance — keep the cheapest model within a set margin of
the best on readiness accuracy and tool choice.

## 11. Product (`docs/product.md`, 2–3 paragraphs)

Threshold: the recap is proposed as soon as an agency could decide whether it can answer —
a catalogue destination, month-level dates, a duration range, a settled or explicitly assumed
party with children's ages. Inferred values are validated in one recap instead of one question
each (serves decided travellers and reduces abandonment); open contradictions and uncovered
destinations block (removes requests an agency cannot answer), and so does a period already
passed. Budget stays optional but inconsistencies surface as indicative alerts. For requests
that never turn into a trip: the brief carries project maturity so agencies can prioritise, the agent helps converge on one destination instead of parallel
requests, and the next step is stated without inventing a response time.

Key production risk: confident but wrong feasibility or health advice shaping a brief the agency
then has to undo — the "Sacred Canyon of Humantay" incident, an AI-invented place in Peru that
sent tourists to altitude unguided, is the concrete example
([OECD.AI](https://oecd.ai/en/incidents/2025-09-29-8b4f)). Mitigations: search before factual
claims, official domains for health, every claim's sources cited under it — one click away since
a card's are collapsed — catalogue gate, alerts phrased as points to check with the agency.
Metric: grounded-claim rate and sampled human review.

Cost (estimate, to be measured with production tracing): $0.13–0.27 per 10-turn conversation with caching depending on
output tokens (300–800 per step), i.e. about $650–1,350 per month at 5,000 conversations,
excluding Tavily; reported per brief sent. This exceeds the Anthropic Start tier monthly cap
([rate limits](https://platform.claude.com/docs/en/api/rate-limits)), so production needs a
higher tier.

## 12. Repository and Claude Code

- pnpm, Node 24 (`.nvmrc`, and what CI runs), TypeScript strict, ESLint + Prettier, Vitest; `.env.example` listing
  `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`.
- `CLAUDE.md` (< 200 lines), `.claude/settings.json` (permissions, post-edit format hook),
  project skills: `verify-docs`, `add-agent-tool`.
- GitHub Actions CI: lint, format check, typecheck, test, build.
- README: what the interface does not say; how to run; a short summary of each design document
  with a link; assumptions (the guides written for the project, the catalogue standing in for
  agency coverage); "Next steps" linking to §15's backlog instead of copying it.
- Docs: `docs/architecture.md`, `docs/adr/`, `docs/observability.md`, `docs/evaluation.md`,
  `docs/product.md`, `docs/specs/`.
- Both guides go through a human content review before the agent uses them: their wording is
  what the agent says to travellers about health and responsible travel.

Proven building blocks instead of custom code (each confirmed against its docs when first
used): AI SDK chat UI components if an official set fits (AI Elements), otherwise accessible
primitives from a maintained library (Radix UI through shadcn/ui: WAI-ARIA patterns, keyboard
navigation and focus management built in, components copied into the repo so they stay
editable) for radio groups, drawer and disclosure; Streamdown (streaming-safe markdown) for message rendering; the official OpenStreetMap embed (iframe) if the tile policy allows it; the official Tavily JS SDK; zod for every schema; `node:crypto`
(`createHash`) for the brief hash; AI SDK helpers for
message validation and pruning.

Every third-party config (Next, ESLint, TypeScript, Vitest, workflow, Claude Code settings) is
written from its official documentation and the commit cites the source.

## 13. Testing

- Unit (Vitest): schema, merge rules (including correction and quote basis), recompute from
  history, both gates, catalogue check, guide prerequisites, source provenance, the family health check on the live and replay paths, one `ask_traveler` per step,
  search topic domain restriction, each server tool with Tavily mocked, search failure path, route
  body limits, system prompt free of guide text, agency-readable rendering, context pruning.
- Pipeline: streaming handler with `MockLanguageModelV4` from `ai/test`
  ([testing](https://ai-sdk.dev/docs/ai-sdk-core/testing)), malformed and system messages,
  approval decisions and step-cap settings; forged history, free text while a question is
  pending and single-question handling are covered by the state and client-helper unit tests.
- Trajectories: a scripted model plays a multi-step turn through `createChatResponse`, and the
  assertions read the emitted UI stream. This is the layer that proves the gates are wired into
  `streamText`, not merely correct in isolation: the send denial and its reason, the stale
  version, the family guide required before both the send and the destination card, a model
  that records a family, loads `family_travel` on its own with no step forced and reaches the
  send, a family card refused until the model runs the health search naming its destination, a
  two-card turn emitting both cards with their labels and no question after them, the step cap
  forcing a text answer, a search failure surfacing as a structured error, and the two stream
  error messages together with the log line each writes — the error name, and the status code
  for an `APICallError`. The closing turn is asserted here too: a successful send emits no text part
  after the tool output, while a refused approval and a gate-denied version both still let the
  model answer, and a contract test replays the closing turn's own chunks through
  `readUIMessageStream` — that turn writes them itself instead of going through
  `toUIMessageStream`, so the card reaching the traveller is worth an assertion. A contract test
  pins the SDK's approval chunk order — a denial is the server's
  (`isAutomatic: true`, immediate response), while a passing gate emits a bare
  `tool-approval-request` and ends the turn for the traveller to confirm — so an `ai` upgrade
  that changes the protocol fails here instead of making those assertions vacuous.
- Manual end to end in a browser on the five entry intents (§10) and on mobile width. jsdom
  is deliberately not used for any of it: it would assert a simulation of the library's focus
  restore, of the cascade and of the accessibility tree rather than the things themselves. The
  run has to exercise:
  - focus lands on the composer after answering a choice card, after responding to the recap,
    after "Nouveau voyage" (both the header dialog and the button inside a sent brief) and after
    "Voir le récapitulatif" on desktop, and after "Continuer ce voyage" or Escape in the confirm
    dialog. On mobile that last one ends on the sheet trigger, Radix's restore running after
    `focusComposer()` (§8): check that it does, and that it is never `<body>`;
  - `document.scrollHeight` stays within `window.innerHeight`: only the transcript scrolls, and
    the header and the composer never leave the screen. Tailwind's `sr-only` is
    `position: absolute` with no offsets, so a hidden span with no positioned ancestor is laid
    out against the initial containing block, escapes the scroller and stretches the page — a
    run measured the status line's span at `top: 1327.74px` for a 730px viewport. The transcript
    content element is `relative` for that reason, which covers every `sr-only` span inside it:
    the speaker prefixes, the answered-question prefix, the new-tab notices and the status line.
    The check is on the page, not on the one span, because any future hidden text falls under it;
  - Tab reaches the transcript when the visible turns are plain prose, and the arrow keys then
    scroll it;
  - "Abandonner le voyage" in the confirm dialog shows the blue edge, and every default-variant
    and every ghost button — the two disclosure triggers on a card, "Nouveau voyage",
    "Abandonner" — shows an opaque blue ring on keyboard focus, not a pale halo; the edge rule
    wins on cascade order, not specificity, so DevTools has to confirm it is not overridden, and
    the ring comes from the variant's class, so `focus-visible:ring-ring/50` must be absent from
    the rendered class list;
  - with the OS set to reduce motion, the two disclosure chevrons snap to their open position
    instead of rotating;
  - a checked checkbox and a checked radio keep a visible border on a selected row;
  - the page floor is `--canvas`, and the panel's unfilled progress segments read as a track;
  - the sheet's close button is named "Fermer", and opening the sheet logs no Radix
    missing-description warning;
  - a screen reader announces the speaker once per turn, a destination card's alerts do not
    interrupt what is being read, and a source link's name includes its publisher;
  - heading navigation reaches the choice card's question and the two cards' own
    "Laquelle retenez-vous ?", and the transcript is reachable as a named region;
  - two destination cards in one turn are side by side and row-aligned. On a turn holding two
    cards, at viewport 1280 and again at 390, in the console:

    ```js
    const tops = (sel) =>
      [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().top));
    console.log(
      [...document.querySelectorAll('[data-slot="card"]')].map((c) =>
        Math.round(c.getBoundingClientRect().height),
      ),
      {
        titles: tops('[data-slot="card"] h4'),
        spines: tops('[data-slot="card"] dl'),
        alerts: tops('[data-slot="card"] section h5'),
        choices: tops('[data-slot="card-footer"]'),
      },
    );
    ```

    At 1280 the two heights are equal and each is ≈ 713px — the pair occupies one card's worth of
    scroll, against ≈ 1 186px stacked — and the two values inside `titles`, inside `spines`, inside
    `alerts` and inside `choices` are equal to the pixel. That shared baseline is what the subgrid
    buys and the thing that fails silently without it, so it is the assertion to make, not the
    heights; the two buttons sitting on one line is the same invariant where the traveller acts.
    At 390 the container query does not fire: the cards stack, each ≈ 709px, and the baselines no
    longer have to match. A solo card is ≈ 490px and has no footer. Every figure is arithmetic
    from the tokens and the run is what measures them. Three cards in one turn is the one geometry
    nothing compiled — the third has to wrap into a second band of seven rows and subgrid onto it;
  - a card with no alert renders "À savoir" with "Pas de point d'attention relevé." and keeps its
    seven blocks, so its column still corresponds to the other's row for row;
  - « Je retiens {label} » sends that sentence as the traveller's message, the composer takes the
    focus and the transcript's auto-scroll does not leave the focused control off screen; the
    other card's button stays clickable and sends the correction; and the longest catalogue label
    wraps inside the 314px column instead of being clipped;
  - a turn that renders nothing announces nothing: no "Assistant : " with silence behind it, and
    no empty gap in the transcript. The known edge is a turn holding only an `ask_traveler` part
    that its card declines to render — mid-stream, or after a tool error — which still emits the
    prefix;
  - the transport error reads in full at every width: its button sits under the sentence, not
    over it, since a French label overruns the padding an absolutely positioned action reserves.

## 14. To verify before implementing

Frozen as the 2026-09-17 record. This section is the check-list as it stood before the code
existed, not a live to-do list: every item below shipped, and what each answer turned out to be
reads in the section that depends on it.

Confirmed against official documentation (2026-09-17): `addToolOutput`, `sendAutomaticallyWhen`, `validateUIMessages`, tool
approval (used without the experimental signing secret: the server re-checks readiness and the
brief hash), `MockLanguageModelV4`, `effort` for `claude-sonnet-5` in `@ai-sdk/anthropic`, `pruneMessages`.

Left to check on 2026-09-17: v7 streaming response helpers; `cacheControl` syntax in
`@ai-sdk/anthropic`; conditional approval (gate before approval) and denial reasons; how the provider maps `strict`;
Next.js 16 current version and `create-next-app` flags; Vercel function max duration for
multi-step turns; Tavily JS SDK, `include_domains` and free quota; Anthropic workspace spend
limits; OpenStreetMap tile usage policy; AI Elements
and shadcn/ui fit with Next.js 16 and AI SDK 7.

## 15. Backlog

Not built in the prototype. Anything that comes up during implementation and is not in §1–§14 goes
here instead of into the code. The README's "Next steps" section links to it instead of
reproducing it.

**P1 — first steps towards production**

- Server-side persistence per `chatId`, accepting only the latest message.
- EU inference (Claude on Vertex AI `eu` or an EU-hosted provider) and data-processing review.
- Live agency coverage by destination and region instead of the static catalogue; the agencies'
  minimum budgets instead of search-based alerts.
- Implemented evaluation pipeline (scenarios, simulated traveller, calibrated judge) as a gate
  in CI, then the multi-provider comparison.
- Real sending to an agency, with account creation and consent, behind a signed
  approval (`experimental_toolApprovalSecret`) as §7 explains.
- Tracing wired as designed in `docs/observability.md` (Langfuse, EU region, masking).

**P2 — reliability and operations**

- LiteLLM gateway with model fallback; per-IP rate limiting; authentication, which a hosted
  deployment would need before its URL is shared.
- Online evaluation on sampled traces, A/B tests of prompts and effort levels.
- Health-gate destination matching on more than whole words of the catalogue label: it
  over-matches, a search naming « Guinée équatoriale » unlocking the card for « Guinée », and
  under-matches, a search naming only the common name — « Birmanie », « Hong Kong » — being
  refused for the CLDR labels « Myanmar (Birmanie) » and « R.A.S. chinoise de Hong Kong ».
- Automated Claude review in CI, Dependabot, Docker image.
- Broader test suite: Playwright end-to-end flows in CI (choice card, free text while a question
  is pending, recap send and edit, mobile drawer) replaying recorded
  `/api/chat` streams, with focus-order assertions for the choice card and the recap card; Vitest
  coverage threshold on `lib/`; `pnpm audit` in CI; component tests. The current suite covers
  the domain logic, tools and chat pipeline.

**P3 — product extensions**

- Follow-up after the agency reply, for requests that stall once answered.
- Destination photos. They help the traveller picture the trip better than a map does — a map answers
  "where is it", a photo answers "would I want to be there", and the map is also one part of a
  card that can be silently wrong, since the model supplies the coordinates. Not built here: the
  catalogue holds only `{id, label}` for 249 destinations, so a curated set means sourcing, a
  per-image licence, attribution and French alt text, and an automatic lookup by name risks
  illustrating a "sans les foules" recommendation with a crowded beach. A photo would go in the
  solo card only: 177px of image per column would be the tallest block of the comparison form and
  would push the fact spine below the fold, so the comparison form is photo-proof and adding
  photos later touches one variant.
- Validate model-supplied `coordinates` against the catalogue, which has none today.
- Interactive map; multi-language.
- Group co-planning, emotion-based entry, voice.
- Exposing the agent as a ChatGPT app / MCP tool (`create_trip_brief`).
- RAG over a corpus of agency itineraries to ground recommendations.

## Revision history

| Revision | Date | Changes |
|---|---|---|
| 1 | 2026-09-29 | Standalone version of the design. |
| 2 | 2026-09-29 | §2 and §2.1: model moved to `claude-sonnet-5-5` at `medium` effort with the server-side refusal fallback ([ADR 0008](../adr/0008-sonnet-5-5.md)); the prompt's 80-word cap per message is removed. |
