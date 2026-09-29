import { toolFailure, type ToolError } from "@/lib/agent/errors";
import type { GuideName } from "@/lib/agent/guides";
import type { SearchOutcome, SearchTopic } from "@/lib/agent/search";
import { MISSING_LABELS } from "@/lib/brief/labels";
import { confirmMandatoryFields, mergeBrief } from "@/lib/brief/merge";
import { hasFamilySignals, missingForRecap, type MissingItem } from "@/lib/brief/readiness";
import { EMPTY_BRIEF, type TripBrief, type TripBriefPatch } from "@/lib/brief/schema";
import { briefVersion, isReadyToSend } from "@/lib/brief/version";
import { destinationLabel } from "@/lib/catalogue";

export type UpdateTripBriefOutput =
  | {
      ok: true;
      brief: TripBrief;
      version: string;
      missingForRecap: MissingItem[];
      requiredGuide?: "family_travel";
    }
  | { ok: false; error: ToolError };

export type ConversationState = {
  brief: TripBrief;
  loadedGuides: Set<GuideName>;
  searchUrls: Set<string>;
  healthSearches: Set<string>;
};

export function createState(): ConversationState {
  return {
    brief: EMPTY_BRIEF,
    loadedGuides: new Set(),
    searchUrls: new Set(),
    healthSearches: new Set(),
  };
}

export function familyGuideMissing(state: ConversationState): boolean {
  return hasFamilySignals(state.brief) && !state.loadedGuides.has("family_travel");
}

// Padded with spaces so that a name only matches as whole words: « Oman » is inside « romantique ».
function foldedWords(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return ` ${words} `;
}

// One recorder for a search, shared by the live tool and by the replay of a client-sent history,
// so the provenance and health gates see the same searches on both paths.
export function recordSearch(
  state: ConversationState,
  input: { query: string; topic: SearchTopic },
  outcome: SearchOutcome,
): void {
  if (!outcome.ok) return;
  for (const hit of outcome.results) state.searchUrls.add(hit.url);
  if (input.topic === "health_formalities") state.healthSearches.add(foldedWords(input.query));
}

export function healthSearchMissing(state: ConversationState, destinationId: string): boolean {
  if (!hasFamilySignals(state.brief)) return false;
  // The compact spelling lets « Vietnam » name the destination the catalogue labels « Viêt Nam ».
  const label = destinationLabel(destinationId);
  const names = [label, label.replace(/[\s-]+/g, "")].map(foldedWords);
  return ![...state.healthSearches].some((query) => names.some((name) => query.includes(name)));
}

export function sendDenial(
  state: ConversationState,
  today: Date,
  approvedVersion: string,
): string | undefined {
  const missing = missingForRecap(state.brief, today);
  if (missing.length > 0) {
    return `Brief incomplet, il manque : ${missing.map((m) => MISSING_LABELS[m]).join(", ")}.`;
  }
  if (familyGuideMissing(state)) return "Chargez d'abord le guide family_travel.";
  if (!isReadyToSend(state.brief, today, approvedVersion)) {
    return `Version périmée, la version actuelle est ${briefVersion(state.brief)}.`;
  }
  return undefined;
}

export function invalidSources(state: ConversationState, urls: string[]): string[] {
  return urls.filter((url) => !state.searchUrls.has(url));
}

// One writer for the brief, shared by the live tool and by the replay of a client-sent history,
// so the two can never drift into computing a different brief from the same patch.
export function applyPatch(
  state: ConversationState,
  today: Date,
  patch: TripBriefPatch,
): UpdateTripBriefOutput {
  const alertSources = (patch.feasibilityAlerts ?? []).flatMap((alert) => alert.sources);
  const invalid = invalidSources(state, alertSources);
  if (invalid.length > 0) {
    return toolFailure(
      "validation",
      `Sources d'alerte invalides (doivent provenir de search_web) : ${invalid.join(", ")}.`,
    );
  }
  state.brief = mergeBrief(state.brief, patch);
  return {
    ok: true,
    brief: state.brief,
    version: briefVersion(state.brief),
    missingForRecap: missingForRecap(state.brief, today),
    ...(familyGuideMissing(state) ? { requiredGuide: "family_travel" as const } : {}),
  };
}

// Approving the recap confirms what the agency will read. The promotion has to be applied here
// rather than only in the tool result, because the state is rebuilt from the history on every
// request: a send that did not leave a trace would let the mandatory fields fall back to `inferred`.
export function applySend(state: ConversationState): TripBrief {
  state.brief = confirmMandatoryFields(state.brief);
  return state.brief;
}
