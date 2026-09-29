# Observability

This is a design, not implemented. Nothing here is wired: the application has no analytics, no tracker, no cookie and no
tracing. The only thing it writes is a server-side error line carrying the error name and, for an
`APICallError`, the HTTP status code — never conversation content.

What is observable today without tracing: the status line names a guide while the agent loads it,
the recap card is where the brief an approval is bound to is reviewed, and the trajectory tests
and the gates prove the load happened, with the test suite also asserting the absence of guide
text in the system prompt. Nothing on screen records afterwards which guides a conversation
loaded ([ADR 0007](adr/0007-no-internals-in-the-interface.md)). That covers someone reading one
conversation. It does not answer any question about a population of
conversations, which is what the rest of this document is for.

## Proposed setup

Langfuse, through its official AI SDK OpenTelemetry integration. Reasons it fits this agent rather
than a generic APM: it is open source and can be self-hosted or used on EU cloud, and it tracks
sessions, token usage, cost and prompt versions natively — which are exactly the axes the signals
below need.

- One session per conversation, so the funnel is measurable end to end.
- One span per step of the agentic loop and one per tool call, including one per guide load. The
  loop already has the right shape for this: a step is a model call plus its tool calls.
- Token usage recorded per call, cache reads separated from fresh input tokens, since the cache
  read ratio is what makes the cost figure in [`docs/product.md`](product.md) hold.
- Prompt version attached to every trace, so a prompt change is visible as a break in the metrics
  rather than as unexplained drift.

## Signals

| Area                   | Signal                                                                                                                                                                                                 | Why                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Funnel                 | briefs sent per conversation started, turns to `isReadyForRecap`, drop-off turn, recap approval and "Modifier" rates                                                                                    | abandonment before the brief is sent               |
| Brief quality          | completeness at send, inferred values corrected at the recap per field, contradictions opened and resolved, uncovered destinations proposed                                                             | requests an agency cannot answer                   |
| Maturity               | distribution of `projectMaturity` at send                                                                                                                                                              | travellers who do not follow up                    |
| Agent behaviour        | tool-call distribution, choice cards versus free-text answers, re-asked confirmed fields, questions per conversation, guide load when family signals exist, gate rejections by type                     | loops, over-questioning, missed guides             |
| Grounding              | factual answers preceded by a search, cards rejected for unknown sources, rate of "could not verify" answers                                                                                            | hallucination risk                                 |
| Reliability            | tool errors by category, schema failures, provider 429 and 529, step-cap hits                                                                                                                           | structured-output and tool-call failures           |
| Cost and latency       | cost per conversation and per brief sent, cache read ratio, first token and turn duration p50/p95                                                                                                        | viability at several thousand conversations a month |
| Downstream (production)| agency response and refusal reasons, traveller follow-up, bookings                                                                                                                                      | unanswered requests and follow-up in production    |
| Safety                 | off-topic and injection-like inputs                                                                                                                                                                     | abuse and prompt injection                         |

Most of these are already derivable from the conversation state without new instrumentation:
`missingForRecap`, the tool error categories, the gate rejections and the loaded guides are all
computed server-side on every turn. Tracing is what turns them into a series.

## Latency targets

To measure, not measured: first visible feedback under 1 s (the status line), first token p95 under
4 s, and a recommendation turn — guide load, searches, cards — p95 under 25 s. The status line
exists because the third target cannot be met by making the turn shorter.

## Alerting

Examples, each tied to a signal above: cost per brief drifting from its baseline; a spike in tool
errors; a drop in the cache read ratio (the usual cause is a change to the static prefix); a
guide-load miss rate above zero, which means a family conversation reached a recommendation without
its guide; latency p95 above target.

## Privacy constraints on any tracing

These are constraints on the design, not options:

- EU region for the tracing backend, short retention.
- `evidence`, `constraints` and `projectSummary` masked. The agent asks for no identity data, but a
  traveller may volunteer health or mobility information — special-category data under GDPR — and
  those three fields are where free text lands.
- Minimisation downstream: the agency-readable text carries only what the agency needs; per-field
  status and evidence stay in the JSON.
- Today no conversation is logged or sent to any third party other than the model and search
  providers. Adding tracing changes that, so it comes with the data-processing review listed in the
  spec's P1 backlog, alongside EU inference.
