import { describe, expect, it } from "vitest";
import { renderAgencyText } from "@/lib/brief/agency-text";
import { formatBudget, formatDates, formatTravelers } from "@/lib/brief/labels";
import { mergeBrief } from "@/lib/brief/merge";
import { tripBriefPatchSchema } from "@/lib/brief/schema";
import { decidedBrief } from "./fixtures";

const today = new Date("2026-09-17T10:00:00Z");

describe("labels", () => {
  it("formats dates in French", () => {
    expect(formatDates({ precision: "month", start: "2026-11" })).toBe("novembre 2026");
    expect(formatDates({ precision: "month", start: "2027-07", end: "2027-08" })).toBe(
      "entre juillet 2027 et août 2027",
    );
    expect(formatDates({ precision: "season", season: "été", year: 2027 })).toBe("été 2027");
  });

  it("formats travellers with children ages", () => {
    expect(
      formatTravelers({ partyType: "family", adults: 2, children: [{ age: 5 }, { age: 0 }] }),
    ).toBe("En famille · 2 adultes, 2 enfants (5 ans, moins d’un an)");
  });

  // The panel and the recap already label the row « Budget », so the value does not repeat it.
  it("formats budget for the three ideal/max shapes", () => {
    const base = { currency: "EUR", basis: "perPersonExcludingInternationalFlights" } as const;
    expect(formatBudget({ ...base, ideal: 2000 })).toMatch(
      /^2\s000\s€ par personne hors vols internationaux$/u,
    );
    expect(formatBudget({ ...base, max: 2500 })).toMatch(
      /^maximum 2\s500\s€ par personne hors vols internationaux$/u,
    );
    expect(formatBudget({ ...base, ideal: 2000, max: 2500 })).toMatch(
      /^2\s000\s€, maximum 2\s500\s€ par personne hors vols internationaux$/u,
    );
  });

  it("prints one figure when the ideal budget equals the maximum", () => {
    expect(
      formatBudget({
        currency: "EUR",
        basis: "perPersonExcludingInternationalFlights",
        ideal: 1500,
        max: 1500,
      }),
    ).toMatch(/^1\s500\s€ par personne hors vols internationaux$/u);
  });

  it("formats a budget the traveller leaves to the agency", () => {
    expect(
      formatBudget({
        declined: true,
        currency: "EUR",
        basis: "perPersonExcludingInternationalFlights",
      }),
    ).toBe("à définir avec l’agence");
  });
});

describe("renderAgencyText", () => {
  it("starts with a one-line header", () => {
    const text = renderAgencyText(decidedBrief, today);
    const header = text.split("\n")[0];
    expect(header).toContain("Viêt Nam");
    expect(header).toContain("novembre 2026");
    expect(header).toContain("20 à 21 nuits");
    expect(header).toContain("2 adultes");
    // The header has no row labels, so it names the budget where the panel does not need to.
    expect(header).toMatch(/ · budget 2\s000\s€ par personne hors vols internationaux$/u);
  });

  it("lists attention points, open points, wishes, summary and maturity in order", () => {
    const brief = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        feasibilityAlerts: [
          { kind: "season", message: "Pluies fréquentes au centre en novembre", sources: [] },
        ],
        constraints: ["allergie aux fruits à coque"],
        alternativesConsidered: ["Cambodge"],
        interests: ["street food", "baie d'Halong"],
        projectSummary: "Premier grand voyage en Asie.",
        projectMaturity: { value: "planning", status: "confirmed" },
      }),
    );
    const text = renderAgencyText(brief, today);
    const order = [
      "Points d’attention",
      "Pluies fréquentes",
      "allergie aux fruits à coque",
      "Points ouverts",
      "Cambodge",
      "Envies et préférences",
      "street food",
      "Résumé du voyage",
      "Premier grand voyage",
      "Avancement de la réflexion : Préparation en cours",
    ].map((needle) => text.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("says how many wishes were cut instead of dropping them silently", () => {
    const brief = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        // Five wishes plus the fixture's departure country: one line over the five shown.
        interests: ["street food", "baie d'Halong", "rizières", "plongée", "marchés"],
      }),
    );
    const text = renderAgencyText(brief, today);
    expect(text).toContain("… 1 autre point dans le détail technique");
  });

  // `plural` only suffixes the last word, so a two-word group used to render
  // "3 autre points" — the adjective stayed singular. The one-item case above passes either way.
  it("agrees the whole group when more than one wish is cut", () => {
    const brief = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        interests: [
          "street food",
          "baie d'Halong",
          "rizières",
          "plongée",
          "marchés",
          "trek",
          "pagodes",
          "café égouttis",
        ],
      }),
    );
    const text = renderAgencyText(brief, today);
    expect(text).toContain("… 4 autres points dans le détail technique");
  });

  it("flags a departure within 30 days", () => {
    const brief = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        dates: {
          value: { precision: "exact", start: "2026-10-01", end: "2026-10-22" },
          status: "confirmed",
        },
      }),
    );
    expect(renderAgencyText(brief, today)).toContain("Départ dans moins de 30 jours");
  });

  it("does not flag a departure that already happened", () => {
    const brief = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        dates: {
          value: { precision: "exact", start: "2026-08-01", end: "2026-08-22" },
          status: "confirmed",
        },
      }),
    );
    expect(renderAgencyText(brief, today)).not.toContain("Départ dans moins de 30 jours");
  });

  it("lists unresolved contradictions in the open points, worded for the agency", () => {
    const contradicted = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        destination: { value: { destinationId: "LA" }, status: "confirmed", evidence: "le Laos" },
      }),
    );
    const text = renderAgencyText(contradicted, today);
    expect(text).toContain(
      `Destination\u00a0: \u00ab\u00a0Vietnam\u00a0\u00bb puis \u00ab\u00a0le Laos\u00a0\u00bb — à clarifier`,
    );
  });

  it("renders a readable value instead of raw JSON when the contradicting patch has no evidence", () => {
    const contradicted = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        destination: { value: { destinationId: "LA" }, status: "confirmed" },
      }),
    );
    const text = renderAgencyText(contradicted, today);
    expect(text).toContain(
      `Destination\u00a0: \u00ab\u00a0Vietnam\u00a0\u00bb puis \u00ab\u00a0Laos\u00a0\u00bb — à clarifier`,
    );
    expect(text).not.toContain("destinationId");
    expect(text).not.toContain("{");
  });

  it("keeps resolved contradictions out of the open points", () => {
    const contradicted = mergeBrief(
      decidedBrief,
      tripBriefPatchSchema.parse({
        destination: { value: { destinationId: "LA" }, status: "confirmed", evidence: "le Laos" },
      }),
    );
    const resolved = mergeBrief(
      contradicted,
      tripBriefPatchSchema.parse({
        destination: { value: { destinationId: "LA" }, status: "confirmed", evidence: "le Laos" },
        resolves: ["destination"],
      }),
    );
    expect(renderAgencyText(resolved, today)).not.toContain("à clarifier");
  });

  it("never exposes field statuses or evidence quotes", () => {
    const text = renderAgencyText(decidedBrief, today);
    expect(text).not.toContain("inferred");
    expect(text).not.toContain("on est 2");
  });
});
