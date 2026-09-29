import { destinationLabel } from "@/lib/catalogue";
import type { MissingItem } from "@/lib/brief/readiness";
import type { DatesValue, TrackedFieldName, TravelersValue, TripBrief } from "@/lib/brief/schema";

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export const FIELD_LABELS: Record<TrackedFieldName, string> = {
  destination: "Destination",
  dates: "Période",
  duration: "Durée",
  travelers: "Voyageurs",
  projectMaturity: "Avancement de la réflexion",
  budget: "Budget",
  occasion: "Occasion spéciale",
  departureCountry: "Pays de départ",
  rhythm: "Rythme",
  accommodation: "Hébergement",
  guidance: "Accompagnement souhaité",
};

export const STATUS_LABELS = {
  confirmed: "Vous l’avez dit",
  inferred: "À vérifier",
  missing: "À préciser",
} as const;

export const MISSING_LABELS: Record<MissingItem, string> = {
  destination: "la destination",
  dates: "la période du voyage",
  datesPrecision: "le mois du départ",
  datesPast: "une période à venir",
  duration: "la durée",
  durationMismatch: "une durée compatible avec les dates",
  travelers: "les voyageurs",
  childrenAges: "l’âge des enfants",
  partySize: "le nombre de voyageurs pour le devis",
  budget: "un budget, ou votre choix d’en parler avec l’agence",
  openContradiction: "un point contradictoire à clarifier",
};

const PARTY_LABELS: Record<TravelersValue["partyType"], string> = {
  alone: "En solo",
  couple: "En couple",
  family: "En famille",
  friends: "Entre amis",
  group: "En groupe",
};

const MATURITY_LABELS = {
  inspiration: "Recherche d’idées",
  planning: "Préparation en cours",
  bookingSoon: "Réservation prochaine",
} as const;

const RHYTHM_LABELS = {
  singleBase: "Poser vos valises et rayonner (1 hébergement)",
  fewStops: "Combiner quelques étapes (2 à 3 hébergements)",
  frequentMoves: "Changer souvent de lieux (4 hébergements ou plus)",
  unknown: "À définir",
} as const;

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

export function formatDates(dates: DatesValue): string {
  switch (dates.precision) {
    case "exact":
      return `du ${DAY.format(new Date(dates.start))} au ${DAY.format(new Date(dates.end))}`;
    case "month": {
      const start = MONTH.format(new Date(`${dates.start}-01`));
      if (!dates.end || dates.end === dates.start) return start;
      return `entre ${start} et ${MONTH.format(new Date(`${dates.end}-01`))}`;
    }
    case "season":
      return `${dates.season} ${dates.year}`;
  }
}

function formatDuration(duration: { minNights: number; maxNights: number }): string {
  return duration.minNights === duration.maxNights
    ? plural(duration.minNights, "nuit")
    : `${duration.minNights} à ${duration.maxNights} nuits`;
}

function formatAge(age: number | undefined): string {
  if (age === undefined) return "âge à préciser";
  return age === 0 ? "moins d’un an" : plural(age, "an");
}

export function formatTravelers(travelers: TravelersValue): string {
  const people = [plural(travelers.adults, "adulte")];
  if (travelers.children.length > 0) {
    const ages = travelers.children.map((child) => formatAge(child.age)).join(", ");
    people.push(`${plural(travelers.children.length, "enfant")} (${ages})`);
  }
  return `${PARTY_LABELS[travelers.partyType]} · ${people.join(", ")}`;
}

export function formatBudget(budget: NonNullable<TripBrief["budget"]>["value"]): string {
  if (budget.declined) return "à définir avec l’agence";
  const amounts =
    budget.ideal !== undefined && budget.ideal === budget.max
      ? [EUR.format(budget.ideal)]
      : [
          budget.ideal !== undefined ? EUR.format(budget.ideal) : undefined,
          budget.max !== undefined ? `maximum ${EUR.format(budget.max)}` : undefined,
        ].filter(Boolean);
  if (amounts.length === 0) return "à préciser";
  return `${amounts.join(", ")} par personne hors vols internationaux`;
}

export type TrackedFieldValue = NonNullable<TripBrief[TrackedFieldName]>["value"];

const FORMATTERS: {
  [F in TrackedFieldName]?: (value: NonNullable<TripBrief[F]>["value"]) => string;
} = {
  destination: (value) =>
    [destinationLabel(value.destinationId), value.region].filter(Boolean).join(" — "),
  dates: formatDates,
  duration: formatDuration,
  travelers: formatTravelers,
  budget: formatBudget,
  projectMaturity: (value) => MATURITY_LABELS[value],
  rhythm: (value) => RHYTHM_LABELS[value],
};

export function formatTrackedValue(field: TrackedFieldName, value: TrackedFieldValue): string {
  // Each formatter is type-checked against its own field above; the two parameters arrive
  // uncorrelated, so their pairing is taken on trust here and nowhere else. The remaining
  // fields hold a plain string.
  const format = FORMATTERS[field] as ((value: TrackedFieldValue) => string) | undefined;
  return format ? format(value) : String(value);
}

export const GUIDE_LABELS = {
  family_travel: "Conseils famille",
  responsible_travel: "Conseils voyage responsable",
} as const;

export const LIST_FIELD_LABELS = {
  interests: "Envies et style de voyage",
  constraints: "Contraintes",
} as const;
