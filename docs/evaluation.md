# Evaluation

This is a design, not implemented. Nothing here runs: there is no evaluation harness in the
repository, and the test suite covers domain logic, tools and
the chat pipeline, not model behaviour. What follows is what would be built, in the order it would
be built, and the rule that would decide a model change.

## What to measure, in priority order

1. **The readiness decision.** Precision and recall of "ready to send". The two errors are not
   symmetric: a false positive sends an unanswerable brief to an agency, a false negative keeps
   asking a traveller who has already given everything and loses them. This is the metric the
   product stands on, so it is measured first and separately.
2. **Per-field extraction accuracy**, stratified by intent and by ambiguity type — a vague date, an
   uncertain party size, an implicit correction, a contradiction.
3. **Tool choice per turn**, guide triggering, and whether recommendations stay inside the
   catalogue.
4. **Grounding.** Factual claims backed by a retrieved source; health answers coming from official
   domains.
5. **Conversation efficiency.** Questions asked, values re-asked after confirmation, turns to the
   recap, and zero questions for a traveller who arrived decided.
6. **Tone and French quality**, the family register when the guide applies, and the absence of
   absolute eco-claims.

## Ground truth

The honest source of "sufficient" is the agency side: historical Demandes de devis with the
agency's response or refusal reason tell us which briefs could be acted on. Failing access to that,
a review by an agency on a sample. A small hand-labelled set is then used to calibrate the LLM
judge — the judge is trusted only as far as it agrees with humans on that set.

Without one of these, the readiness metric measures agreement with our own gate, which is
circular.

## Method

**Scenarios.** The four entry points the welcome screen offers — no destination yet, one
destination in mind, several to compare, a family trip — plus: a decided traveller who gives everything
in one message, "on sera 4 ou 6", a contradiction and an explicit correction, a family trigger, a
responsible-travel request, an uncovered destination, a health question, an off-topic message, and
injection attempts by both vectors — in the traveller's own input and inside a search result.

**Multi-turn runs.** A simulated traveller (a model with a persona and a hidden set of facts) plays
the conversation, so the agent is evaluated on dialogue rather than on single turns.

**Assertions.** Two layers. Deterministic assertions on what can be checked exactly: which tools
were called, in what order, whether a guide was loaded before a card, and the final brief compared
field by field. An LLM judge from a different provider for what cannot: tone, question quality, the
phrasing of alerts. At least three runs per scenario, because a single run measures sampling noise
as much as behaviour.

**Where it runs.** Offline on every prompt or model change, as a migration gate before merge —
promptfoo would fit, and the existing CI already has the shape for it. Online, a sample of
production traces goes to human review, which is also what keeps the judge honest over time.

## Model comparison

The comparison this evaluation exists to settle: `claude-sonnet-5-5` at `low` and at `medium` effort
against Mistral Medium 3.5, on the same scenarios. See [`docs/adr/0002-model.md`](adr/0002-model.md)
and [`docs/adr/0008-sonnet-5-5.md`](adr/0008-sonnet-5-5.md)
for why those three.

The decision rule is written before the numbers exist: keep the cheapest model that stays within a
set margin of the best on readiness accuracy and tool choice. Cost and latency break ties;
they do not override a readiness regression.

## What this does not cover

Conversion — whether a brief becomes a booking — cannot be evaluated offline. It is a downstream
production metric, listed as such in [`docs/observability.md`](observability.md), and it is the one
that ultimately says whether the readiness threshold was set correctly.
