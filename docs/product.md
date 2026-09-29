# Product

## Where the threshold sits

The agent proposes the recap as soon as an agency could decide whether it can answer: a catalogue
destination, dates at month level, a duration range, and a party that is settled or explicitly
assumed with the children's ages. Not "everything known" — enough to act on. Inferred values are
not each turned into a question; they are marked as inferred and validated together in one recap,
which serves both a traveller who arrived decided and one who would abandon a long qualification
flow before the end. What does block is what an agency cannot work around: an unresolved
contradiction and a destination no local agency covers, the two that turn a quote request into
one no agency can answer, and a period that has already passed, which no agency can quote at all.
Budget stays optional, asked once and skippable, with inconsistencies surfaced as indicative
alerts phrased "à ajuster avec l'agence" rather than as a refusal. For travellers who may not
follow up after the agency replies, the brief carries project maturity so agencies can prioritise, the agent pushes towards one
destination instead of several parallel requests, and the sent card states what would happen next
without inventing a response time.

## The risk that matters in production

Confident but wrong feasibility or health advice, shaping a brief the agency then has to undo. The
concrete precedent is the "Sacred Canyon of Humantay", a place invented by an AI travel assistant
in Peru, which sent tourists to altitude unguided
([OECD.AI](https://oecd.ai/en/incidents/2025-09-29-8b4f)). The mitigations are structural rather
than stylistic: search before any factual claim, official domains only for health and formalities,
sources shown with their domain next to the card that uses them, a catalogue gate that makes an
invented destination unrepresentable, and alerts phrased as points to check with the agency instead
of verdicts. The metric that tracks it is the grounded-claim rate, with sampled human review — it
is in [`docs/observability.md`](observability.md), and it is the reason grounding is priority four
in [`docs/evaluation.md`](evaluation.md) rather than an afterthought.

## What it costs

An estimate, to be replaced by production tracing: $0.13–0.27 per 10-turn conversation with
caching, the range depending on output tokens (300–800 per step), which is about $650–1,350 a month
at 5,000 conversations, excluding Tavily. The figure that should be reported is cost per brief
sent, not per conversation: a conversation that ends without a brief costs the same and delivers
nothing, so the ratio between the two is the efficiency signal. At that volume the spend exceeds
the Anthropic Start tier's monthly cap
([rate limits](https://platform.claude.com/docs/en/api/rate-limits)), so production needs a higher
tier — a procurement step, not an engineering one, but one worth knowing before launch.
