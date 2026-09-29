# Guides loaded on demand, with deterministic prerequisites

Status: accepted; the UI chip named under Verifiability is superseded by
[0007](0007-no-internals-in-the-interface.md)

## Context

The agent follows two bodies of instruction written for the project: advice for travelling with
children, and responsible-travel principles for recommendations. Each is relevant to a minority of
conversations, so they are fetched when needed instead of sitting in the system prompt or being
permanently injected.

Two things have to be true at once: the guide must reach the model when it matters, and someone
checking the agent's behaviour must be able to see that it did.

## Decision

Each guide is a file — `guides/family_travel/SKILL.md`, `guides/responsible_travel/SKILL.md` — reachable
only through the `load_guide` tool, which reads it from disk and returns its body as a tool result.
Nothing else puts guide text in the context.

The trigger rules live in the tool description: `family_travel` as soon as children, a family party
or a family trip are mentioned; `responsible_travel` before recommending a destination, or when the
traveller asks to avoid crowds, get off the beaten track or travel more responsibly.

Because a description is a hint and not a guarantee, the prerequisites are also gates in code,
checked against the replayed conversation state:

- `show_destination_card` returns a `business` error, "Chargez d'abord le guide responsible_travel
  avec load_guide", if `responsible_travel` was never loaded;
- with family signals in the brief and no `family_travel` load, `show_destination_card` returns the
  same kind of error and the `propose_quote_request` approval is denied with "Chargez d'abord le
  guide family_travel";
- `update_trip_brief` returns `requiredGuide: "family_travel"` as soon as family signals appear, so
  the model learns about the obligation at the moment the fact is recorded.

Verifiability is part of the decision: the UI shows a chip ("Conseils famille activés", "Conseils
voyage responsable activés") once a guide is loaded, and a unit test asserts that no guide text
appears in the system prompt.

## Alternatives considered

**Both guides in the system prompt.** Simplest and most reliable for compliance. Not chosen: it
puts instructions about children in every conversation, including those with no children, pays
their tokens on every turn, and leaves no signal of when a guide actually shaped an answer.

**Prompt-only triggers, no gates.** Fewer moving parts, but the guarantee then rests on the model
noticing a signal mid-conversation. A missed family trigger produces a recommendation that ignores
the family instructions — a silent failure with no signal in the transcript.

**An external skills runtime (DeepAgents, Claude Agent SDK Skills).** Progressive disclosure is
native there. Rejected with the runtimes themselves in [0001-stack](0001-stack.md); a file plus a
tool gives the same lazy loading without a second service.

**Retrieval over guide chunks.** Useful if the guides were large or numerous. With two short
documents, chunking only introduces the risk of loading the wrong half of a rule.

## Consequences

- A conversation with no family and no recommendation never pays for guide tokens; a guide is
  loaded once and stays in the conversation from then on.
- A missed trigger becomes a visible, recoverable business error instead of ungrounded advice. The
  cost is a wasted step in the loop when the model forgets.
- Guide content can change without touching code, and goes through a human content review like
  any other text the agent follows.
- The gates read the replayed state, so a client that deletes a `load_guide` turn from its history
  loses the guide but does not bypass the prerequisite.
- Observability gets a concrete signal: guide loads when family signals exist, and gate rejections
  by type (see [`docs/observability.md`](../observability.md)).

---

2026-09-21 — one clause reversed, by [0007](0007-no-internals-in-the-interface.md). The
Verifiability paragraph above makes the UI chip part of this decision; the interface no longer
tells the traveller which guide was loaded, because nothing describing how the app works belongs
on the traveller's screen. Everything else here stands: lazy loading through `load_guide`, the
trigger rules in the tool description, the three deterministic gates, and the unit test asserting
that no guide text reaches the system prompt. 0007 names what to read in the chip's place to
check that a guide was loaded.
