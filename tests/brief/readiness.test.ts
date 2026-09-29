import { describe, expect, it } from "vitest";
import { mergeBrief } from "@/lib/brief/merge";
import {
  blockedFields,
  hasFamilySignals,
  isReadyForRecap,
  missingForRecap,
} from "@/lib/brief/readiness";
import { tripBriefPatchSchema } from "@/lib/brief/schema";
import { briefVersion, isReadyToSend } from "@/lib/brief/version";
import { decidedBrief, EMPTY_BRIEF } from "./fixtures";

const today = new Date("2026-09-21T10:00:00Z");
const apply = (input: unknown) => mergeBrief(decidedBrief, tripBriefPatchSchema.parse(input));
const withDates = (value: unknown) => apply({ dates: { value, status: "confirmed" } });

describe("readiness", () => {
  it("lists every mandatory field on an empty brief", () => {
    expect(missingForRecap(EMPTY_BRIEF, today)).toEqual([
      "destination",
      "dates",
      "duration",
      "travelers",
    ]);
  });

  it("accepts inferred values so a decided traveller reaches the recap", () => {
    expect(isReadyForRecap(decidedBrief, today)).toBe(true);
  });

  it("requires month precision", () => {
    const brief = apply({
      dates: { value: { precision: "season", season: "été", year: 2027 }, status: "inferred" },
    });
    expect(missingForRecap(brief, today)).toEqual(["datesPrecision"]);
  });

  it("refuses a month that has already passed", () => {
    expect(missingForRecap(withDates({ precision: "month", start: "2026-02" }), today)).toEqual([
      "datesPast",
    ]);
  });

  it("accepts the current month, which has days left", () => {
    expect(
      missingForRecap(withDates({ precision: "month", start: "2026-09" }), today),
    ).not.toContain("datesPast");
  });

  it("accepts a month still to come this year", () => {
    expect(
      missingForRecap(withDates({ precision: "month", start: "2026-12" }), today),
    ).not.toContain("datesPast");
  });

  it("refuses a season whose year has passed", () => {
    expect(
      missingForRecap(withDates({ precision: "season", season: "hiver", year: 2025 }), today),
    ).toEqual(["datesPrecision", "datesPast"]);
  });

  it("accepts an exact range that has started but has not ended", () => {
    expect(
      missingForRecap(
        withDates({ precision: "exact", start: "2026-09-20", end: "2026-09-22" }),
        today,
      ),
    ).not.toContain("datesPast");
  });

  it("refuses an exact range that ended before today", () => {
    expect(
      missingForRecap(
        withDates({ precision: "exact", start: "2026-02-01", end: "2026-02-15" }),
        today,
      ),
    ).toContain("datesPast");
  });

  it("requires every child age", () => {
    const brief = apply({
      travelers: {
        value: { partyType: "family", adults: 2, children: [{ age: 5 }, {}] },
        status: "confirmed",
      },
    });
    expect(missingForRecap(brief, today)).toEqual(["childrenAges"]);
  });

  it("requires an age for a family that recorded no child at all", () => {
    const brief = apply({
      travelers: { value: { partyType: "family", adults: 2 }, status: "confirmed" },
    });
    expect(missingForRecap(brief, today)).toEqual(["childrenAges"]);
  });

  it("accepts a family once one child is recorded with an age", () => {
    const brief = apply({
      travelers: {
        value: { partyType: "family", adults: 2, children: [{ age: 6 }] },
        status: "confirmed",
      },
    });
    expect(missingForRecap(brief, today)).toEqual([]);
  });

  it("does not ask for a child age when the party is not a family", () => {
    const brief = apply({
      travelers: { value: { partyType: "group", adults: 6 }, status: "confirmed" },
    });
    expect(missingForRecap(brief, today)).toEqual([]);
  });

  it("blocks an open party size unless a quote basis is chosen", () => {
    const open = apply({
      travelers: {
        value: { partyType: "friends", adults: 4, uncertainty: "4 ou 6" },
        status: "inferred",
      },
    });
    expect(missingForRecap(open, today)).toEqual(["partySize"]);
    const withBasis = apply({
      travelers: {
        value: {
          partyType: "friends",
          adults: 4,
          uncertainty: "4 ou 6",
          quoteBasis: "devis pour 4, ajustable à 6",
        },
        status: "confirmed",
      },
    });
    expect(isReadyForRecap(withBasis, today)).toBe(true);
  });

  it("flags a duration mismatch when the exact dates are shorter than the minimum duration", () => {
    const brief = apply({
      dates: {
        value: { precision: "exact", start: "2026-11-01", end: "2026-11-08" },
        status: "confirmed",
      },
    });
    expect(missingForRecap(brief, today)).toEqual(["durationMismatch"]);
  });

  it("flags a duration mismatch when the exact dates are longer than the maximum duration", () => {
    const brief = apply({
      dates: {
        value: { precision: "exact", start: "2026-11-01", end: "2026-12-15" },
        status: "confirmed",
      },
    });
    expect(missingForRecap(brief, today)).toEqual(["durationMismatch"]);
  });

  it("blocks on an open contradiction", () => {
    const brief = mergeBrief(
      apply({ destination: { value: { destinationId: "VN" }, status: "confirmed" } }),
      tripBriefPatchSchema.parse({
        destination: { value: { destinationId: "JP" }, status: "confirmed" },
      }),
    );
    expect(missingForRecap(brief, today)).toEqual(["openContradiction"]);
  });

  it("detects family signals", () => {
    expect(hasFamilySignals(decidedBrief)).toBe(false);
    expect(
      hasFamilySignals(
        apply({
          travelers: { value: { partyType: "family", adults: 2 }, status: "inferred" },
        }),
      ),
    ).toBe(true);
  });
});

describe("version", () => {
  it("is stable for the same brief and changes with content", () => {
    expect(briefVersion(decidedBrief)).toMatch(/^[0-9a-f]{16}$/);
    expect(briefVersion(structuredClone(decidedBrief))).toBe(briefVersion(decidedBrief));
    expect(briefVersion(apply({ interests: ["randonnée"] }))).not.toBe(briefVersion(decidedBrief));
  });

  it("does not depend on the order patches were applied", () => {
    const interestsPatch = tripBriefPatchSchema.parse({ interests: ["randonnée"] });
    const constraintsPatch = tripBriefPatchSchema.parse({ constraints: ["pas de vols de nuit"] });
    const orderA = mergeBrief(mergeBrief(decidedBrief, interestsPatch), constraintsPatch);
    const orderB = mergeBrief(mergeBrief(decidedBrief, constraintsPatch), interestsPatch);
    expect(briefVersion(orderA)).toBe(briefVersion(orderB));
  });

  it("allows sending only the approved version of a ready brief", () => {
    expect(isReadyToSend(decidedBrief, today, briefVersion(decidedBrief))).toBe(true);
    expect(isReadyToSend(decidedBrief, today, "0000000000000000")).toBe(false);
    expect(isReadyToSend(EMPTY_BRIEF, today, briefVersion(EMPTY_BRIEF))).toBe(false);
  });
});

describe("blockedFields", () => {
  it("maps every missing item to the mandatory field it holds up", () => {
    expect([...blockedFields(["datesPrecision", "childrenAges"])]).toEqual(["dates", "travelers"]);
    expect([...blockedFields(["datesPast"])]).toEqual(["dates"]);
    expect([...blockedFields(["durationMismatch"])]).toEqual(["duration"]);
    expect([...blockedFields(["partySize", "travelers"])]).toEqual(["travelers"]);
  });

  it("blocks no field for an open contradiction, which still blocks the send", () => {
    expect([...blockedFields(["openContradiction"])]).toEqual([]);
  });
});
