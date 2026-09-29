import { describe, expect, it } from "vitest";
import { confirmMandatoryFields, mergeBrief } from "@/lib/brief/merge";
import { tripBriefPatchSchema } from "@/lib/brief/schema";
import { decidedBrief, EMPTY_BRIEF } from "./fixtures";

const patch = (input: unknown) => tripBriefPatchSchema.parse(input);

describe("mergeBrief", () => {
  it("sets a field on an empty brief", () => {
    const brief = mergeBrief(
      EMPTY_BRIEF,
      patch({ destination: { value: { destinationId: "LK" }, status: "confirmed" } }),
    );
    expect(brief.destination?.value.destinationId).toBe("LK");
  });

  it("replaces an inferred value without opening a contradiction", () => {
    const brief = mergeBrief(
      decidedBrief,
      patch({ dates: { value: { precision: "month", start: "2026-12" }, status: "confirmed" } }),
    );
    expect(brief.dates?.value).toEqual({ precision: "month", start: "2026-12" });
    expect(brief.contradictions).toEqual([]);
  });

  it("opens a contradiction when a confirmed value changes without resolution", () => {
    const brief = mergeBrief(
      decidedBrief,
      patch({
        destination: { value: { destinationId: "LA" }, status: "confirmed", evidence: "le Laos" },
      }),
    );
    expect(brief.destination?.value.destinationId).toBe("VN");
    expect(brief.contradictions).toEqual([
      { field: "destination", statements: ["Vietnam", "le Laos"], resolved: false },
    ]);
  });

  it("does not duplicate an open contradiction", () => {
    const conflicting = patch({
      destination: { value: { destinationId: "LA" }, status: "confirmed", evidence: "le Laos" },
    });
    const brief = mergeBrief(mergeBrief(decidedBrief, conflicting), conflicting);
    expect(brief.contradictions).toHaveLength(1);
    expect(brief.contradictions[0]?.statements).toEqual(["Vietnam", "le Laos"]);
  });

  it("appends a new statement to an already open contradiction", () => {
    const withConflict = mergeBrief(
      decidedBrief,
      patch({
        destination: { value: { destinationId: "LA" }, status: "confirmed", evidence: "le Laos" },
      }),
    );
    const brief = mergeBrief(
      withConflict,
      patch({
        destination: {
          value: { destinationId: "JP" },
          status: "confirmed",
          evidence: "ou le Japon",
        },
      }),
    );
    expect(brief.destination?.value.destinationId).toBe("VN");
    expect(brief.contradictions).toEqual([
      { field: "destination", statements: ["Vietnam", "le Laos", "ou le Japon"], resolved: false },
    ]);
  });

  it("records a readable French value, not raw JSON, when the contradicting patch has no evidence", () => {
    const brief = mergeBrief(
      decidedBrief,
      patch({ destination: { value: { destinationId: "LA" }, status: "confirmed" } }),
    );
    const contradiction = brief.contradictions.find((c) => c.field === "destination");
    expect(contradiction?.statements).toContain("Laos");
    const joined = contradiction?.statements.join(" ") ?? "";
    expect(joined).not.toContain("{");
    expect(joined).not.toContain("destinationId");
  });

  it("stops appending once an open contradiction reaches the statement cap", () => {
    let brief = decidedBrief;
    for (const evidence of ["le Laos", "toujours le Laos", "vraiment le Laos", "encore le Laos"]) {
      brief = mergeBrief(
        brief,
        patch({ destination: { value: { destinationId: "LA" }, status: "confirmed", evidence } }),
      );
    }
    expect(brief.contradictions).toHaveLength(1);
    expect(brief.contradictions[0]?.statements).toHaveLength(4);
    expect(brief.contradictions[0]?.statements).toEqual([
      "Vietnam",
      "le Laos",
      "toujours le Laos",
      "vraiment le Laos",
    ]);
  });

  it("applies an explicit correction and resolves the contradiction", () => {
    const withConflict = mergeBrief(
      decidedBrief,
      patch({ destination: { value: { destinationId: "LA" }, status: "confirmed" } }),
    );
    const brief = mergeBrief(
      withConflict,
      patch({
        destination: {
          value: { destinationId: "LA" },
          status: "confirmed",
          evidence: "finalement plutôt le Laos",
        },
        resolves: ["destination"],
      }),
    );
    expect(brief.destination?.value.destinationId).toBe("LA");
    expect(brief.contradictions.every((c) => c.resolved)).toBe(true);
  });

  it("applies a resolves correction even without a prior open contradiction", () => {
    const brief = mergeBrief(
      decidedBrief,
      patch({
        destination: {
          value: { destinationId: "LA" },
          status: "confirmed",
          evidence: "plutôt le Laos finalement",
        },
        resolves: ["destination"],
      }),
    );
    expect(brief.destination?.value.destinationId).toBe("LA");
    expect(brief.contradictions).toEqual([]);
  });

  it("clears a field with null and replaces arrays", () => {
    const brief = mergeBrief(decidedBrief, patch({ budget: null, interests: ["plongée"] }));
    expect(brief.budget).toBeUndefined();
    expect(brief.interests).toEqual(["plongée"]);
  });

  it("replaces constraints, alternativesConsidered and feasibilityAlerts", () => {
    const brief = mergeBrief(
      decidedBrief,
      patch({
        constraints: ["éviter les vols de nuit"],
        alternativesConsidered: ["Thaïlande"],
        feasibilityAlerts: [{ kind: "season", message: "risque de mousson en novembre" }],
      }),
    );
    expect(brief.constraints).toEqual(["éviter les vols de nuit"]);
    expect(brief.alternativesConsidered).toEqual(["Thaïlande"]);
    expect(brief.feasibilityAlerts).toEqual([
      { kind: "season", message: "risque de mousson en novembre", sources: [] },
    ]);
  });

  it("sets and clears projectSummary", () => {
    const withSummary = mergeBrief(
      decidedBrief,
      patch({ projectSummary: "Lune de miel de trois semaines au Vietnam" }),
    );
    expect(withSummary.projectSummary).toBe("Lune de miel de trois semaines au Vietnam");

    const cleared = mergeBrief(withSummary, patch({ projectSummary: null }));
    expect(cleared.projectSummary).toBeUndefined();
  });

  it("rejects an inverted duration", () => {
    expect(() =>
      patch({ duration: { value: { minNights: 10, maxNights: 5 }, status: "inferred" } }),
    ).toThrow();
  });

  it("rejects a destination outside the catalogue", () => {
    expect(() =>
      patch({ destination: { value: { destinationId: "atlantide" }, status: "confirmed" } }),
    ).toThrow();
  });
});

describe("confirmMandatoryFields", () => {
  it("promotes present mandatory fields to confirmed and leaves others untouched", () => {
    const brief = confirmMandatoryFields(decidedBrief);
    expect(brief.destination?.status).toBe("confirmed");
    expect(brief.dates?.status).toBe("confirmed");
    expect(brief.duration?.status).toBe("confirmed");
    expect(brief.travelers?.status).toBe("confirmed");
    expect(brief.budget?.status).toBe("inferred");
  });

  it("leaves absent mandatory fields absent", () => {
    const brief = confirmMandatoryFields(EMPTY_BRIEF);
    expect(brief.destination).toBeUndefined();
    expect(brief.dates).toBeUndefined();
    expect(brief.duration).toBeUndefined();
    expect(brief.travelers).toBeUndefined();
  });
});
