# Guidance from the brief's state, applied through the card contract

Status: accepted. Supersedes [0005](0005-lazy-guides.md).

## Context

0005 let the model load two guides with `load_guide` and enforced the loads with prerequisites.
The family guide ended up required in four places: the system prompt, the tool description, a
`requiredGuide` field on `update_trip_brief`, and gates on the card and the send. The guides were
loaded, but their content had little effect. The live baseline (`pnpm eval`) showed a Borneo card
for parents of an 8-year-old whose only caveat was malaria, with nothing for the child and no
word on a 17-hour flight, and no visible responsible-travel suggestion. A text the model reads once
competes with a long system prompt, and a gate on loading checks that the text was fetched, not
that it was applied.

## Decision

- The family guide rides on the brief. `recordPatch` attaches it as `familyGuidance` to the
  `update_trip_brief` result that first records children, once per conversation
  (`familyGuidanceGiven`). The replay re-reads the file on that same update.
- The card contract carries what the guidance asks for. For a family, `buildDestinationCard`
  refuses a card without `forChildren` (what the children will enjoy, at their age) or without at
  least one alert, with a `validation` error naming what to add. Every card carries
  `travelBetter`, one responsible-travel suggestion.
- The responsible-travel principles apply to every recommendation, so they move into the system
  prompt as five lines; `guides/responsible_travel/` is deleted.
- `load_guide`, `requiredGuide`, `loadedGuides` and the guide gates on the card and the send are
  removed. The family health-search gate stays: it guards a safety check, not a load.

## Consequences

- One mechanism per guidance, and no ordering rule in the prompt for it.
- The model cannot show a family card that ignores the children; it can still write a weak
  `forChildren` or caveat, which the live evaluation reads.
- Tabs opened before the deploy carry `tool-load_guide` parts, which the server now rejects as an
  undeclared tool (`400 unexpected_part`). History lives only in the tab, so a reload starts clean.
