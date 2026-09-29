# claude-sonnet-5 at medium effort

Status: superseded by [0008](0008-sonnet-5-5.md)

## Context

The workload is dialogue and extraction: read a French conversation, decide the next action, call
tools with well-formed arguments, and keep a structured brief consistent. It is high-volume and
latency-visible — the traveller waits for the first token. Tool-call correctness matters more than
prose quality, and cost per conversation decides whether the thing is viable at several thousand
conversations a month.

## Decision

`claude-sonnet-5` with `providerOptions.anthropic.effort: "medium"`.

Facts checked on 2026-09-17: $2/$10 per MTok, cache reads $0.20, a 1,024-token cache minimum, the
"Fast" latency class, retirement not before 2027-06-30; strict tool use and structured outputs are
GA; cached input tokens do not count toward input rate limits
([models overview](https://platform.claude.com/docs/en/about-claude/models/overview),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations),
[rate limits](https://platform.claude.com/docs/en/api/rate-limits)).

`effort` defaults to `high` with adaptive thinking; the effort guide recommends lower effort for
high-volume chat, so this starts at `medium` and `low` is the next thing to test
([effort](https://platform.claude.com/docs/en/build-with-claude/effort)). It is fixed per
deployment, because changing it mid-conversation invalidates the cache on Sonnet 5. Non-default
`temperature`, `top_p` and `top_k` are rejected by the API on Sonnet 5 and are never set
([what's new](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5)).

This is a defensible default, not a proven optimum. The evaluation design
([`docs/evaluation.md`](../evaluation.md)) exists to replace the assumption with a measurement.

## Alternatives considered

**Opus 5.** Better on hard reasoning, 2.5× the cost, for a task dominated by dialogue and
extraction. Not chosen: the extra capability does not buy readiness accuracy here, and the cost
lands directly on the per-conversation figure.

**Haiku 4.5.** Cheaper, but previous-generation for this purpose: the static prefix is about 3.5k
tokens, below its 4,096-token cache minimum, so the caching that makes this workload affordable
would not apply; it has no `effort` control; and its retirement is only guaranteed until
2026-10-15.

**Gemini 3.8 Flash, Mistral Medium 3.5, GPT-5.6 Terra, GLM 5.3.** All credible. Checked on
2026-09-17 against the current catalogues: Mistral Medium 3.5 would cost about 27 % less per
conversation than Sonnet 5, GLM 5.3 (served by Mistral, public preview) about 47 % less, and
GPT-5.6 Terra is at price parity
([OpenAI](https://developers.openai.com/api/docs/pricing),
[Gemini](https://ai.google.dev/gemini-api/docs/pricing),
[Mistral](https://mistral.ai/pricing/api)). Not chosen now: strict tool use has no documented
equivalent outside Anthropic, and a preview model carries a one-month deprecation notice. The
switch stays gated on the evaluation rather than on a price list.

**An EU-processing provider today.** EU processing is available from Mistral's dedicated
`api.eu.mistral.ai` endpoint (`api.mistral.ai` routes globally) or from Claude on Vertex AI `eu`,
and not from Anthropic's first-party API, which offers `global` and `us` only
([data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)). Not chosen
for a prototype that stores nothing; EU inference is listed as a P1 production requirement.

## Consequences

- Inference runs on Anthropic's first-party API with `global` processing. The README states it and
  lists EU processing as a production requirement.
- Anthropic-specific code is limited to the cache breakpoints and the `effort` provider option;
  search deliberately does not use a vendor server tool. Switching provider is a factory change
  plus those two details.
- The switch happens if the evaluation shows another model at equal readiness accuracy and tool
  choice for materially lower cost or p95 latency, or if EU-only processing becomes mandatory.
- `effort` cannot be tuned per traveller or per turn without giving up the cache, so effort is a
  deployment-level A/B question, not a runtime one.
