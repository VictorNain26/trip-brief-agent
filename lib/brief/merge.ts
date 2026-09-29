import { isDeepStrictEqual } from "node:util";
import { formatTrackedValue, type TrackedFieldValue } from "@/lib/brief/labels";
import {
  TRACKED_FIELD_NAMES,
  tripBriefSchema,
  type TrackedFieldName,
  type TripBrief,
  type TripBriefPatch,
} from "@/lib/brief/schema";

const LIST_FIELDS = [
  "interests",
  "constraints",
  "alternativesConsidered",
  "feasibilityAlerts",
] as const;

const MANDATORY_FIELDS = ["destination", "dates", "duration", "travelers", "budget"] as const;

export function mergeBrief(brief: TripBrief, patch: TripBriefPatch): TripBrief {
  const next: Record<string, unknown> = structuredClone(brief);
  const resolves = new Set(patch.resolves ?? []);
  let contradictions = [...brief.contradictions];

  for (const field of TRACKED_FIELD_NAMES) {
    const incoming = patch[field];
    if (incoming === undefined) continue;
    if (incoming === null) {
      delete next[field];
      continue;
    }
    const current = brief[field];
    if (resolves.has(field)) {
      next[field] = incoming;
      contradictions = contradictions.map((c) =>
        c.field === field ? { ...c, resolved: true } : c,
      );
      continue;
    }
    if (current?.status === "confirmed" && !isDeepStrictEqual(current.value, incoming.value)) {
      const openIndex = contradictions.findIndex((c) => c.field === field && !c.resolved);
      const newStatement = statementOf(field, incoming);
      if (openIndex === -1) {
        contradictions.push({
          field,
          statements: [statementOf(field, current), newStatement],
          resolved: false,
        });
      } else {
        const open = contradictions[openIndex];
        if (!open.statements.includes(newStatement) && open.statements.length < 4) {
          contradictions[openIndex] = { ...open, statements: [...open.statements, newStatement] };
        }
      }
      continue;
    }
    next[field] = incoming;
  }

  for (const key of LIST_FIELDS) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.projectSummary === null) delete next.projectSummary;
  else if (patch.projectSummary !== undefined) next.projectSummary = patch.projectSummary;

  next.contradictions = contradictions;
  return tripBriefSchema.parse(next);
}

export function confirmMandatoryFields(brief: TripBrief): TripBrief {
  const next: Record<string, unknown> = structuredClone(brief);
  for (const field of MANDATORY_FIELDS) {
    const current = brief[field];
    if (current === undefined) continue;
    next[field] = { ...current, status: "confirmed" };
  }
  return tripBriefSchema.parse(next);
}

function statementOf(
  field: TrackedFieldName,
  tracked: { value: TrackedFieldValue; evidence?: string },
): string {
  return (tracked.evidence ?? formatTrackedValue(field, tracked.value)).slice(0, 200);
}
