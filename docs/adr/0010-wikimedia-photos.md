# Photos from Wikimedia Commons

Status: accepted

## Context

A traveller asking « ça ressemble à quoi ? » got text and a map. A photo answers what a map
cannot: whether one would want to be there. Images need a source whose licence allows showing them
with a credit, and a Content Security Policy that stays narrow.

## Decision

- Photos come from the Wikimedia Commons API only (`lib/agent/photos.ts`): a search over the File
  namespace with `filetype:bitmap`, `imageinfo` for the thumbnail and `extmetadata` for the author
  and licence ([API:Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo),
  [API:Search](https://www.mediawiki.org/wiki/API:Search)). No API key. Requests carry a
  User-Agent with contact details, as the
  [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy)
  asks (`WIKIMEDIA_CONTACT`, defaulting to the repository).
- A destination card gets one photo looked up by the server from the destination's English name; the
  model never chooses it. `show_photos` lets the model show a subject (orangutans, Stone Town).
- Thumbnails are loaded by the browser from `upload.wikimedia.org` and `thumb.wikimedia.org`, the two
  hosts the API returned and the only ones `img-src` allows; `next/image` runs `unoptimized`, so this
  server never fetches third-party images. Output schemas refuse any other host.
- The model sees neither photos nor credits: `toModelOutput` drops the card's photo and reduces a
  `show_photos` output to a count, because the client resends outputs on every turn.
- Commons' author field is HTML. The browser keeps its text with `DOMParser`. `html-entities` and
  `he` were considered and not added: neither has had a commit in the last six months.

## Consequences

- Photo quality depends on Commons' search: a query by country name can return a map or a flag
  photo that happens to be a bitmap. The live evaluation reads what comes back.
- A comparison of two cards shows no photo, so the shared row grid stays aligned.
- Commons being down leaves cards without photos and `show_photos` with a `transient` failure.
