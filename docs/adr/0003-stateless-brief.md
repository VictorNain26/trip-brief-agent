# Brief recomputed from tool inputs, no server state

Status: accepted

## Context

The brief is the deliverable: four mandatory fields plus useful ones, each with a status
(`confirmed` or `inferred`), evidence and notes, and gates that decide when it can be shown and
sent. Something has to hold it between turns.

The route is stateless and the browser sends the whole UI message history on every request. Any
client is untrusted: it can replay, edit or invent any part of that history, including tool
outputs that the model would then read as fact.

## Decision

Keep no server-side state. On every request, rebuild `{ brief, loadedGuides, searchUrls }` by
replaying the **inputs** of `update_trip_brief` and `load_guide` found in the history, re-validating
each patch with `tripBriefPatchSchema` and re-merging it with `mergeBrief`. Client-sent outputs of
those tools are never trusted:

- a historical `update_trip_brief` output is replaced by the recomputed one before the model sees
  it; an invalid patch becomes a `validation` tool failure instead of silently applying,
- a historical `load_guide` output is replaced by the guide file read from disk, once per guide:
  a repeat of a guide already replayed becomes a `business` tool failure rather than another copy
  of the file,
- a destination card's sources are checked against the `search_web` outputs seen in the same
  conversation,
- the send is gated by `sendDenial(state, approvedVersion)` — readiness, the family guide, and an
  `approvedVersion` equal to the SHA-256-derived hash of the brief as it stands right now — called
  both by the approval callback and by the tool's `execute`.

## Alternatives considered

**Trusting the tool outputs already in the history.** Simplest, and wrong: the brief the agency
receives would be whatever the client last claimed it was, and a forged `load_guide` output would
be a direct prompt-injection channel into the model's context.

**A server-side store keyed by `chatId`, accepting only the latest message.** This is the AI SDK
persistence pattern and the right production answer. Not chosen for this prototype: it adds a datastore,
a session identity and a retention policy to a prototype that deliberately stores no traveller
data, and the brief is the only state worth keeping. It is recorded as the first P1 item in the
spec's backlog.

**Signed tool outputs (the experimental approval signing secret).** It would let the server detect
tampering without recomputation. Not chosen: recomputing is cheaper to reason about and covers the
same attacks, and the server re-checks readiness and the brief hash anyway, so the signature adds
nothing this design relies on.

## Consequences

- No database, no session, no retention question, and nothing to clean up: reloading the page ends
  the conversation.
- What a forged history cannot do: make the model read invented guide text or an invented
  `update_trip_brief` output — `trustPart` re-reads the guide from disk for a `tool-load_guide`
  part and recomputes the output from the patch input, and `checkConversation` answers `400` to a
  `dynamic-tool` part, the SDK's fallback for a tool part it cannot attribute to a declared tool,
  whose output would otherwise reach the model unchecked and unreplayed — or bypass the readiness
  and hash gates, which are recomputed server-side on every request.
- What it can do: drive the derived state to any schema-valid value inside its own session.
  `deriveConversationState` replays every `update_trip_brief` input it finds in the history with no
  check that the assistant emitted it, and `tripBriefPatchSchema` accepts `status: "confirmed"` on
  every tracked field, so one handcrafted patch can empty `missingForRecap` and reach an approved
  send; `searchUrls` is likewise populated from client-sent `search_web` outputs, so a card can cite
  a forged URL. `search_web` outputs are not replayed either — re-running the searches would cost a
  Tavily call per historical search on every turn — so a forged snippet's text reaches the model
  prompt verbatim: the same injection channel as a forged guide body, which `trustPart` closes by
  re-reading the file. This is bounded, not prevented: nothing is persisted, the send is simulated,
  and the only party affected is the client doing it. The answer in production is the `chatId` store above —
  accepting only the latest message makes the history the server's rather than the client's.
- The merge is replayed from scratch on every turn. It is a pure function over a bounded history
  (80 messages), so the cost is negligible next to the model call, and it makes the merge rules
  unit-testable in isolation.
- History size is the real limit. `pruneMessages` drops `search_web` calls and results older than
  the last six messages to keep it bounded; provenance checks read the replayed state, not the
  pruned messages, so pruning never loosens a gate.
- Two clients cannot share a conversation, and a traveller cannot resume one. Both need the
  `chatId` persistence above.

---

2026-09-20 — factual correction, not a reversal. The first consequence above ended "which the UI
states"; the prototype notice was removed from the interface that day and the README carries the
three facts instead. The decision, its context and every other consequence are untouched: the
route is still stateless and a reload still ends the conversation.
