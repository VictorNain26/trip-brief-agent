import type { DatesValue, TrackedFieldName, TripBrief } from "@/lib/brief/schema";

export type MissingItem =
  | "destination"
  | "dates"
  | "datesPrecision"
  | "datesPast"
  | "duration"
  | "durationMismatch"
  | "travelers"
  | "childrenAges"
  | "partySize"
  | "openContradiction";

export const DAY_MS = 86_400_000;

// Every variant carries either an ISO day, an ISO month or a year, and ISO 8601 orders
// lexicographically (RFC 3339 §5.1), so the comparison needs no parsing and no date library.
// The end of the range decides, not the start: a traveller already under way still has a brief
// an agency can quote, while a month gone by has none.
function endsBeforeToday(dates: DatesValue, today: Date): boolean {
  const iso = today.toISOString();
  switch (dates.precision) {
    case "exact":
      return dates.end < iso.slice(0, 10);
    case "month":
      return (dates.end ?? dates.start) < iso.slice(0, 7);
    case "season":
      return dates.year < today.getUTCFullYear();
  }
}

export function missingForRecap(brief: TripBrief, today: Date): MissingItem[] {
  const missing: MissingItem[] = [];
  const dates = brief.dates?.value;
  const duration = brief.duration?.value;
  const travelers = brief.travelers?.value;

  if (!brief.destination) missing.push("destination");
  if (!dates) missing.push("dates");
  else {
    if (dates.precision === "season") missing.push("datesPrecision");
    if (endsBeforeToday(dates, today)) missing.push("datesPast");
  }
  if (!duration) missing.push("duration");
  else if (dates?.precision === "exact") {
    const nights = (Date.parse(dates.end) - Date.parse(dates.start)) / DAY_MS;
    if (duration.minNights > nights || duration.maxNights < nights)
      missing.push("durationMismatch");
  }
  if (!travelers) missing.push("travelers");
  else {
    // `family` means travelling with minors, so an empty children list is an unanswered question,
    // not an answer: the brief says the age of each child has to be asked early.
    const childrenUnknown =
      travelers.children.some((child) => child.age === undefined) ||
      (travelers.partyType === "family" && travelers.children.length === 0);
    if (childrenUnknown) missing.push("childrenAges");
    if (travelers.uncertainty && !travelers.quoteBasis) missing.push("partySize");
  }
  if (brief.contradictions.some((c) => !c.resolved)) missing.push("openContradiction");
  return missing;
}

export function isReadyForRecap(brief: TripBrief, today: Date): boolean {
  return missingForRecap(brief, today).length === 0;
}

export function hasFamilySignals(brief: TripBrief): boolean {
  const travelers = brief.travelers?.value;
  return (
    travelers !== undefined && (travelers.partyType === "family" || travelers.children.length > 0)
  );
}

const BLOCKS: Partial<Record<MissingItem, TrackedFieldName>> = {
  destination: "destination",
  dates: "dates",
  datesPrecision: "dates",
  datesPast: "dates",
  duration: "duration",
  durationMismatch: "duration",
  travelers: "travelers",
  childrenAges: "travelers",
  partySize: "travelers",
};

// Which mandatory fields a missing item holds up, so the panel can count what is actually done
// rather than what merely has a value. `openContradiction` blocks the send without blocking a field.
export function blockedFields(missing: MissingItem[]): Set<TrackedFieldName> {
  return new Set(missing.flatMap((item) => (BLOCKS[item] ? [BLOCKS[item]] : [])));
}
