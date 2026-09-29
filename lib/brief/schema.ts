import { z } from "zod";
import { DESTINATION_IDS } from "@/lib/catalogue";

export const TRACKED_FIELD_NAMES = [
  "destination",
  "dates",
  "duration",
  "travelers",
  "projectMaturity",
  "budget",
  "occasion",
  "departureCountry",
  "rhythm",
  "accommodation",
  "guidance",
] as const;

export type TrackedFieldName = (typeof TRACKED_FIELD_NAMES)[number];

function tracked<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    status: z.enum(["confirmed", "inferred"]),
    evidence: z.string().max(300).optional(),
    note: z.string().max(300).optional(),
  });
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/);

export const destinationIdSchema = z.enum(DESTINATION_IDS);

const destinationValue = z.object({
  destinationId: destinationIdSchema,
  region: z.string().max(80).optional(),
  combineWith: z.string().max(120).optional(),
});

const datesValue = z.discriminatedUnion("precision", [
  z.object({
    precision: z.literal("exact"),
    start: isoDay,
    end: isoDay,
    flexibilityDays: z.number().int().min(0).max(30).optional(),
  }),
  z.object({ precision: z.literal("month"), start: isoMonth, end: isoMonth.optional() }),
  z.object({
    precision: z.literal("season"),
    season: z.enum(["printemps", "été", "automne", "hiver"]),
    year: z.number().int().min(2025).max(2100),
  }),
]);

const durationValue = z
  .object({
    minNights: z.number().int().min(1).max(120),
    maxNights: z.number().int().min(1).max(120),
  })
  .refine((d) => d.minNights <= d.maxNights, { error: "minNights must be <= maxNights" });

const travelersValue = z.object({
  partyType: z.enum(["alone", "couple", "family", "friends", "group"]),
  adults: z.number().int().min(1).max(40),
  children: z
    .array(z.object({ age: z.number().int().min(0).max(17).optional() }))
    .max(15)
    .default([]),
  groupType: z.enum(["club", "works_council", "seminar", "other"]).optional(),
  uncertainty: z.string().max(120).optional(),
  quoteBasis: z.string().max(120).optional(),
});

const budgetValue = z.object({
  ideal: z.number().int().positive().optional(),
  max: z.number().int().positive().optional(),
  currency: z.literal("EUR"),
  basis: z.literal("perPersonExcludingInternationalFlights"),
});

const trackedSchemas = {
  destination: tracked(destinationValue),
  dates: tracked(datesValue),
  duration: tracked(durationValue),
  travelers: tracked(travelersValue),
  projectMaturity: tracked(z.enum(["inspiration", "planning", "bookingSoon"])),
  budget: tracked(budgetValue),
  occasion: tracked(z.string().max(80)),
  departureCountry: tracked(z.string().max(60)),
  rhythm: tracked(z.enum(["singleBase", "fewStops", "frequentMoves", "unknown"])),
  accommodation: tracked(z.string().max(120)),
  guidance: tracked(z.string().max(120)),
};

const stringList = (max: number, length: number) => z.array(z.string().max(length)).max(max);

const alertSchema = z.object({
  kind: z.enum(["budget", "season", "health", "pace", "coverage"]),
  message: z.string().max(300),
  sources: z.array(z.httpUrl()).max(5).default([]),
});

const contradictionSchema = z.object({
  field: z.enum(TRACKED_FIELD_NAMES),
  statements: z.array(z.string().max(200)).min(2).max(4),
  resolved: z.boolean(),
});

export const tripBriefSchema = z
  .object(trackedSchemas)
  .partial()
  .extend({
    interests: stringList(15, 80).default([]),
    constraints: stringList(10, 120).default([]),
    alternativesConsidered: stringList(10, 80).default([]),
    projectSummary: z.string().max(600).optional(),
    contradictions: z.array(contradictionSchema).default([]),
    feasibilityAlerts: z.array(alertSchema).max(10).default([]),
  });

export const tripBriefPatchSchema = z.object({
  destination: trackedSchemas.destination.nullable().optional(),
  dates: trackedSchemas.dates.nullable().optional(),
  duration: trackedSchemas.duration.nullable().optional(),
  travelers: trackedSchemas.travelers.nullable().optional(),
  projectMaturity: trackedSchemas.projectMaturity.nullable().optional(),
  budget: trackedSchemas.budget.nullable().optional(),
  occasion: trackedSchemas.occasion.nullable().optional(),
  departureCountry: trackedSchemas.departureCountry.nullable().optional(),
  rhythm: trackedSchemas.rhythm.nullable().optional(),
  accommodation: trackedSchemas.accommodation.nullable().optional(),
  guidance: trackedSchemas.guidance.nullable().optional(),
  interests: stringList(15, 80).optional(),
  constraints: stringList(10, 120).optional(),
  alternativesConsidered: stringList(10, 80).optional(),
  projectSummary: z.string().max(600).nullable().optional(),
  feasibilityAlerts: z.array(alertSchema).max(10).optional(),
  resolves: z.array(z.enum(TRACKED_FIELD_NAMES)).optional(),
});

export type TripBrief = z.infer<typeof tripBriefSchema>;
export type TripBriefPatch = z.infer<typeof tripBriefPatchSchema>;
export type DatesValue = z.infer<typeof datesValue>;
export type TravelersValue = z.infer<typeof travelersValue>;

export const EMPTY_BRIEF: TripBrief = tripBriefSchema.parse({});
