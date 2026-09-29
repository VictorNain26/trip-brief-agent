import { FIELD_LABELS, formatTrackedValue } from "@/lib/brief/labels";
import { DAY_MS } from "@/lib/brief/readiness";
import type { TripBrief } from "@/lib/brief/schema";

export function renderAgencyText(brief: TripBrief, today: Date): string {
  const sections = [
    header(brief),
    section("Points d’attention", attentionPoints(brief, today)),
    section("Points ouverts", openPoints(brief)),
    section("Envies et préférences", wishes(brief)),
    brief.projectSummary ? `Résumé du voyage\n${brief.projectSummary}` : "",
    brief.projectMaturity
      ? `Avancement de la réflexion : ${formatTrackedValue("projectMaturity", brief.projectMaturity.value)}`
      : "",
  ];
  return sections.filter(Boolean).join("\n\n");
}

function header(brief: TripBrief): string {
  const parts = [
    brief.travelers && formatTrackedValue("travelers", brief.travelers.value),
    brief.destination && formatTrackedValue("destination", brief.destination.value),
    brief.dates && formatTrackedValue("dates", brief.dates.value),
    brief.duration && formatTrackedValue("duration", brief.duration.value),
    brief.budget && `budget ${formatTrackedValue("budget", brief.budget.value)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

function section(title: string, lines: string[]): string {
  return lines.length ? `${title}\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}

function attentionPoints(brief: TripBrief, today: Date): string[] {
  const lines = brief.feasibilityAlerts.map((alert) => alert.message);
  lines.push(...brief.constraints);
  const dates = brief.dates?.value;
  if (dates && dates.precision !== "season") {
    const start = Date.parse(dates.precision === "exact" ? dates.start : `${dates.start}-01`);
    const untilDeparture = start - today.getTime();
    if (untilDeparture >= 0 && untilDeparture < 30 * DAY_MS) {
      lines.push("Départ dans moins de 30 jours");
    }
  }
  return lines;
}

function openPoints(brief: TripBrief): string[] {
  const lines: string[] = [];
  const travelers = brief.travelers?.value;
  if (travelers?.uncertainty) {
    lines.push(
      `Nombre de voyageurs : ${travelers.uncertainty} (${travelers.quoteBasis ?? "à confirmer"})`,
    );
  }
  if (brief.destination?.value.combineWith) {
    lines.push(`Souhaite combiner avec : ${brief.destination.value.combineWith}`);
  }
  if (brief.alternativesConsidered.length) {
    lines.push(`A aussi envisagé : ${brief.alternativesConsidered.join(", ")}`);
  }
  for (const contradiction of brief.contradictions) {
    if (contradiction.resolved) continue;
    const quotes = contradiction.statements.map((statement) => `« ${statement} »`).join(" puis ");
    lines.push(`${FIELD_LABELS[contradiction.field]} : ${quotes} — à clarifier`);
  }
  return lines;
}

function wishes(brief: TripBrief): string[] {
  const lines = [...brief.interests];
  for (const field of [
    "occasion",
    "rhythm",
    "accommodation",
    "guidance",
    "departureCountry",
  ] as const) {
    const value = brief[field];
    if (value) lines.push(formatTrackedValue(field, value.value));
  }
  for (const field of ["destination", "dates", "duration", "travelers", "budget"] as const) {
    const note = brief[field]?.note;
    if (note) lines.push(note);
  }
  const shown = lines.slice(0, 5);
  if (lines.length > shown.length) {
    const rest = lines.length - shown.length;
    shown.push(
      `… ${rest} autre${rest > 1 ? "s" : ""} point${rest > 1 ? "s" : ""} dans le détail technique`,
    );
  }
  return shown;
}
