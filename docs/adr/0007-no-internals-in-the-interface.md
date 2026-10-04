# The interface shows the voyage, not the machinery

Status: accepted

## Context

[0005-lazy-guides](0005-lazy-guides.md) made guide loading verifiable by putting a chip in the
project panel: "Conseils famille activés", "Conseils voyage responsable activés", one per guide
the agent had read. That decision named verifiability as part of it, and the chip was the visible
half.

The chip serves whoever checks the agent's behaviour, inside the screen a traveller uses. It names a tool call, a file and a
prerequisite gate — three things the traveller never asked about and cannot act on — and it names
them in the panel that is supposed to mirror the voyage. "Activés" is feature-flag language for an
internal state becoming true.

Watching the app run made the general rule visible behind the particular badge: this interface has
two audiences, and it had started answering the second one in front of the first.

## Decision

Nothing that describes how the app works is put in front of the traveller. What the interface
states is the voyage, what the agent is doing for them right now, and what has or has not
happened to their demande.

The two guide chips are removed from the panel and from its mobile sheet. `loadedGuides()` was
read by nothing else and goes with them, along with its unit test.

The line the rule does *not* cut is the status line, "Consultation des conseils famille", which
stays. The distinction is between a transient statement of what the agent is doing for the
traveller in the seconds it takes — the same class of line as "Recherche : climat du Cap Vert en
février" — and a persistent badge announcing that an internal state is on. The first answers
"what is happening to my request"; the second answers "how is this built".

Honesty disclosures are not machinery either and stay: "Demande de devis (simulée)",
"Prototype : l'envoi est simulé" and "Ici, rien n'a été envoyé" describe what did and did not
happen to the traveller's demande, which they would otherwise be wrong about.

What someone checking the agent's behaviour reads instead of the chip:

- `tests/agent/trajectories.test.ts` asserts the family guide is loaded on a family signal, and
  asserts the `business` error and the denied approval when it is not;
- the gates in `lib/agent/tools.ts` and `lib/agent/state.ts`, which make a missing load a
  recoverable error rather than a silent omission;
- the status line during the turn, which names the guide as it is read.

The brief JSON on the sent card does **not** show it: the schema records the voyage, not which
guides the agent consulted, and adding a field for it would put the machinery back in the
deliverable an agency receives.

## Alternatives considered

**Keep the chip.** It is one badge, it is honest, and it is the cheapest proof that lazy loading
works. Not kept: the rule this project set is about the traveller's screen, not about the badge's
cost, and a rule with an exception for the useful case is not a rule. The verification it carried
is covered above, in the tests, the gates and the status line.

**Move it behind a disclosure, or show it only in development.** Both keep the machinery in the
traveller's panel and add a control or a flag to hide it — an abstraction for a need that does not
exist, and a second code path that the production build would not exercise.

**Show the guide's effect instead of its name** — a note saying advice has been adapted for
children. Rejected: the effect is already in the agent's prose and in the questions it asks; a
label saying "this answer was adapted" is the same self-description in friendlier words.

**Remove `GUIDE_LABELS` and the status line with the chip.** Rejected in the Decision above: the
status line is about the traveller's turn, and removing it would leave several seconds of silence
where the interface currently says what it is doing.

**Reverse it by editing [0005](0005-lazy-guides.md) in place.** Rejected by the repository's own
rule: an ADR is immutable, a reversal is a new ADR, and 0005's decision — lazy loading, trigger
rules in the tool description, three deterministic gates — is untouched by this one. Only its
Verifiability paragraph is superseded.

## Consequences

- The running app no longer shows at a glance that the family guide was loaded. That is a real
  loss and the reason 0005 put the chip there; it is paid for by reading a test or the status line
  as the turn runs.
- The panel holds only the brief, its alerts and the recap button, which is what §8 says it is
  for: a mirror of the voyage, never a second way to act on it.
- The rule is general, so it applies to anything added later — a token count, a model name, a
  retry counter, a tool name in an error. Tool errors already never reach the traveller:
  `message-view.tsx` renders `null` for a failed tool part and shows one of two plain sentences
  instead.
- `GUIDE_LABELS` now has one consumer, the status line, which is where the guide's French name is
  read from.
- 0005's gates, its trigger rules and the unit test keeping guide text out of the system prompt
  are unchanged, so nothing about the loading mechanism moves with this decision.
