# Tavily behind a custom search tool

Status: accepted

## Context

The agent has to answer factual questions before they shape a brief: seasonality, climate,
feasibility, current events, entry formalities, health. Getting these wrong is the main production
risk (see [`docs/product.md`](../product.md)), so answers need sources the traveller can open and
the agency can check.

Health and formalities are a special case: an approximate answer from a travel blog is worse than
no answer.

## Decision

A custom `search_web` tool calling Tavily through its official JS SDK, with a `topic` input:

- `general` — up to 5 results, `searchDepth: "basic"`, 8-second timeout, snippets truncated to 400
  characters, no domain restriction,
- `health_formalities` — the same, restricted to the official domains in `OFFICIAL_HEALTH_DOMAINS`:
  `diplomatie.gouv.fr` (France
  Diplomatie, "Conseils aux voyageurs"), `pasteur.fr` (Institut Pasteur) and `who.int` (WHO). The
  system prompt requires every health answer to end with a referral to a doctor or an international
  vaccination centre.

An empty result list is a valid outcome, not an error. A provider failure returns a `transient`
error and the prompt allows one retry, then a plain-text answer with no card. Result URLs are
recorded in the conversation state and are what `show_destination_card` validates its sources
against.

Tavily returns results with a content snippet in one call, takes an include-domain list per
request, and has a free tier.

## Alternatives considered

**Anthropic's server-side `web_search` tool.** Native citations and no separate provider to wire.
Not chosen: it ties search to one model provider, which is exactly the coupling
[0002-model](0002-model.md) and [0006-portability](0006-portability.md) try to avoid; it gives less
control over how results are trimmed and which domains are allowed, and the domain restriction for
health is the part that carries the most risk here; and it costs $10 per 1,000 searches
([web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)).

**No search, model knowledge only.** Rejected on the grounding requirement: a model's recollection
of visa rules or monsoon dates is frozen at its training cutoff and has no source to show, and web
search is one of the agent's three capabilities.

**Scraping the official sites directly.** More control over the health answer, but it means
maintaining parsers for three sites and handling their outages, for the same result a domain filter
already gives.

## Consequences

- Search is provider-neutral: `SearchFn` is a two-argument function type, and the tests inject a
  mock. Replacing Tavily is one module.
- Health answers cannot cite anything outside the three official domains, by construction. If those
  domains have nothing on a question, the agent says it could not verify it — which is the intended
  failure mode.
- Result quality on the `general` topic is Tavily's, and the truncation to 400 characters can cut a
  useful sentence. The trade is a bounded number of tokens per search in a loop that may run
  several.
- Tavily is a second external dependency and a second failure mode. It is treated as `transient`
  and degrades to a text answer rather than to an error message.
- A card or a feasibility alert can only cite a URL a search returned in the same conversation, so
  provenance is a property of the transcript, not a claim.
