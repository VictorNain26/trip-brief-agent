import { EMPTY_BRIEF, tripBriefPatchSchema, type TripBrief } from "@/lib/brief/schema";
import { mergeBrief } from "@/lib/brief/merge";

export { EMPTY_BRIEF };

function mergeBriefInput(input: unknown): TripBrief {
  return mergeBrief(EMPTY_BRIEF, tripBriefPatchSchema.parse(input));
}

export const decidedPatch = {
  destination: { value: { destinationId: "VN" }, status: "confirmed", evidence: "Vietnam" },
  dates: {
    value: { precision: "month", start: "2026-11" },
    status: "inferred",
    evidence: "en novembre",
  },
  duration: { value: { minNights: 20, maxNights: 21 }, status: "inferred", evidence: "3 semaines" },
  travelers: {
    value: { partyType: "couple", adults: 2, children: [] },
    status: "inferred",
    evidence: "on est 2",
  },
  budget: {
    value: { ideal: 2000, currency: "EUR", basis: "perPersonExcludingInternationalFlights" },
    status: "inferred",
    evidence: "budget ~4000€",
  },
};

export const decidedBrief: TripBrief = mergeBriefInput(decidedPatch);

export const familyPatch = {
  ...decidedPatch,
  travelers: {
    value: { partyType: "family", adults: 2, children: [{ age: 6 }] },
    status: "confirmed",
    evidence: "avec notre fils de 6 ans",
  },
};

export const familyBrief: TripBrief = mergeBriefInput(familyPatch);
