import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecuteFunction, ToolExecutionOptions } from "ai";
import { toolFailure } from "@/lib/agent/errors";
import { createState, type ConversationState } from "@/lib/agent/state";
import { createTools, destinationCardInputSchema } from "@/lib/agent/tools";
import { searchOutcomeSchema, type SearchFn } from "@/lib/agent/search";
import { tripBriefPatchSchema } from "@/lib/brief/schema";
import { briefVersion } from "@/lib/brief/version";
import { decidedBrief } from "../brief/fixtures";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
const readFileMock = vi.mocked(readFile);

const today = new Date("2026-09-17T10:00:00Z");
const options = {
  toolCallId: "call-1",
  messages: [],
  context: {},
} as ToolExecutionOptions<Record<string, unknown>>;

// `execute` is typed to allow an AsyncIterable return (streaming tools); none of our tools
// stream, so this helper narrows the union back to a single awaited value for the tests.
async function run<INPUT, OUTPUT>(
  toolDef: { execute?: ToolExecuteFunction<INPUT, OUTPUT, Record<string, unknown>> },
  input: INPUT,
): Promise<OUTPUT> {
  const result = toolDef.execute;
  if (!result) throw new Error("tool has no execute");
  return result(input, options) as PromiseLike<OUTPUT> | OUTPUT;
}

function setup(state: ConversationState = createState(), search?: SearchFn) {
  const searchFn: SearchFn =
    search ??
    vi.fn(async () => ({
      ok: true as const,
      results: [
        {
          title: "Climat",
          url: "https://example.org/climat",
          domain: "example.org",
          snippet: "...",
        },
      ],
    }));
  return { state, tools: createTools({ state, search: searchFn, today }), search: searchFn };
}

const card = {
  destinationId: "LK",
  region: "Asie du Sud",
  why: "Plages et nature en hiver, saison sèche sur la côte sud.",
  bestPeriod: "décembre à mars",
  highlights: ["Côte sud", "Plantations de thé"],
  alerts: [],
  sources: [{ title: "Climat", url: "https://example.org/climat" }],
  coordinates: { lat: 7.87, lng: 80.77 },
  flightTimeFromParis: "11 h",
  travelBetter: "En février, la côte est reste plus calme que la côte sud.",
};

const familyBriefWithChild = {
  ...decidedBrief,
  travelers: {
    value: { partyType: "family" as const, adults: 2, children: [{ age: 6 }] },
    status: "confirmed" as const,
  },
};

describe("tools", () => {
  beforeEach(() => {
    readFileMock.mockClear();
  });

  it("ask_traveler has no execute (client-side)", () => {
    expect(setup().tools.ask_traveler.execute).toBeUndefined();
  });

  it("search_web records returned URLs", async () => {
    const { tools, state } = setup();
    const outcome = await run(tools.search_web, { query: "Sri Lanka hiver", topic: "general" });
    expect(outcome.ok).toBe(true);
    expect(state.searchUrls.has("https://example.org/climat")).toBe(true);
  });

  it("search_web passes a transient failure through unchanged and records no URL", async () => {
    const failure = toolFailure("transient", "La recherche web est indisponible pour le moment.");
    const failingSearch: SearchFn = vi.fn(async () => failure);
    const { tools, state } = setup(createState(), failingSearch);
    const outcome = await run(tools.search_web, { query: "Sri Lanka hiver", topic: "general" });
    expect(outcome).toEqual(failure);
    expect(state.searchUrls.size).toBe(0);
  });

  // Fails if the guidance stops riding on the update that first records children, or comes back
  // on every later update: the model would lack it when it matters, or carry one copy per update.
  it("update_trip_brief hands the family guidance over once, when children are first recorded", async () => {
    const { tools, state } = setup();
    const first = await run(tools.update_trip_brief, {
      travelers: {
        value: { partyType: "family", adults: 2, children: [{ age: 4 }] },
        status: "confirmed",
      },
    });
    if (!first.ok) throw new Error("expected update_trip_brief to succeed");
    expect(state.brief.travelers?.value.children).toEqual([{ age: 4 }]);
    expect(first.familyGuidance).toContain("L'âge de chaque enfant");
    expect(first.missingForRecap).toEqual(["destination", "dates", "duration", "budget"]);
    expect(first.version).toBe(briefVersion(state.brief));

    const second = await run(tools.update_trip_brief, {
      destination: { value: { destinationId: "PT" }, status: "confirmed" },
    });
    if (!second.ok) throw new Error("expected update_trip_brief to succeed");
    expect(second.familyGuidance).toBeUndefined();
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it("update_trip_brief gives no family guidance to a couple", async () => {
    const { tools } = setup();
    const output = await run(tools.update_trip_brief, {
      travelers: { value: { partyType: "couple", adults: 2, children: [] }, status: "confirmed" },
    });
    if (!output.ok) throw new Error("expected update_trip_brief to succeed");
    expect(output.familyGuidance).toBeUndefined();
  });

  // Fails if the family contract is dropped: the live run proposed Borneo to parents of an
  // 8-year-old with no word for the child and no caveat about the flight.
  it("show_destination_card refuses a family card without children content or a caveat", async () => {
    const state = createState();
    state.brief = familyBriefWithChild;
    state.searchUrls.add("https://example.org/climat");
    const { tools } = setup(state);
    await run(tools.search_web, {
      query: "vaccins Sri Lanka enfants",
      topic: "health_formalities",
    });
    const noChildren = await run(tools.show_destination_card, {
      ...card,
      alerts: ["Vol de 11 h avec un enfant de 6 ans : prévoir une escale."],
    });
    expect(noChildren).toMatchObject({
      ok: false,
      error: { errorCategory: "validation", message: expect.stringContaining("forChildren") },
    });
    const noCaveat = await run(tools.show_destination_card, {
      ...card,
      forChildren: "Tortues marines et éléphants à observer de loin.",
    });
    expect(noCaveat).toMatchObject({ ok: false, error: { errorCategory: "validation" } });
    const complete = await run(tools.show_destination_card, {
      ...card,
      alerts: ["Vol de 11 h avec un enfant de 6 ans : prévoir une escale."],
      forChildren: "Tortues marines et éléphants à observer de loin.",
    });
    expect(complete).toMatchObject({ ok: true, card: { forChildren: expect.any(String) } });
  });

  it("show_destination_card requires a travelBetter suggestion on every card", () => {
    const { travelBetter, ...withoutSuggestion } = card;
    expect(travelBetter).toBeTruthy();
    expect(destinationCardInputSchema.safeParse(withoutSuggestion).success).toBe(false);
  });

  it("show_destination_card rejects sources that no search returned", async () => {
    const { tools } = setup();
    const output = await run(tools.show_destination_card, card);
    expect(output).toMatchObject({ ok: false, error: { errorCategory: "validation" } });
  });

  it("show_destination_card returns the card with the catalogue label", async () => {
    const { tools, state } = setup();
    state.searchUrls.add("https://example.org/climat");
    const output = await run(tools.show_destination_card, card);
    expect(output).toMatchObject({
      ok: true,
      card: { destinationId: "LK", label: "Sri Lanka" },
    });
  });

  describe("for a family, show_destination_card requires a health search naming the destination", () => {
    const capVert = {
      ...card,
      destinationId: "CV",
      region: "Afrique de l’Ouest",
      coordinates: { lat: 16, lng: -24 },
      flightTimeFromParis: "6 h",
      alerts: ["Vol de 6 h avec un enfant de 6 ans : prévoir de quoi l’occuper."],
      forChildren: "Plages calmes et tortues marines à observer à distance.",
    };

    function familySetup() {
      const state = createState();
      state.brief = familyBriefWithChild;
      state.searchUrls.add("https://example.org/climat");
      return setup(state);
    }

    // Fails if the gate disappears: the live run that recommended Cap Vert to a family without
    // any health search would pass again.
    it("refuses the card when no health search was made, and says what to run", async () => {
      const { tools } = familySetup();
      const output = await run(tools.show_destination_card, capVert);
      expect(output).toMatchObject({
        ok: false,
        error: {
          errorCategory: "business",
          message: expect.stringMatching(/search_web[\s\S]*health_formalities[\s\S]*Cap-Vert/),
        },
      });
    });

    // Fails if any health search unlocks every destination.
    it("refuses the card when the only health search named another destination", async () => {
      const { tools } = familySetup();
      await run(tools.search_web, { query: "vaccins Égypte enfants", topic: "health_formalities" });
      const output = await run(tools.show_destination_card, capVert);
      expect(output).toMatchObject({ ok: false, error: { errorCategory: "business" } });
    });

    // Fails if a general search, or a health search that failed, counts as the health check.
    it("does not count a general search or a failed health search", async () => {
      const failure = toolFailure("transient", "La recherche web est indisponible pour le moment.");
      const { tools, state } = familySetup();
      await run(tools.search_web, { query: "Cap Vert santé enfants", topic: "general" });
      const failing = setup(
        state,
        vi.fn(async () => failure),
      ).tools;
      await run(failing.search_web, { query: "Cap Vert vaccins", topic: "health_formalities" });
      const output = await run(tools.show_destination_card, capVert);
      expect(output).toMatchObject({ ok: false, error: { errorCategory: "business" } });
    });

    // Fails if matching stops folding case, accents, hyphens or spaces: the model writes the
    // query as free text, and each of these spellings names the destination.
    it.each([
      ["CV", "Paludisme Cap-Vert enfants"],
      ["CV", "vaccins cap vert"],
      ["CV", "CAP VERT santé"],
      ["PE", "vaccins Pérou enfants"],
      ["PE", "paludisme PEROU"],
      ["CI", "Côte d’Ivoire paludisme"],
      ["VN", "vaccins Vietnam enfants"],
    ])("accepts a %s card after the health search %j", async (destinationId, query) => {
      const { tools } = familySetup();
      await run(tools.search_web, { query, topic: "health_formalities" });
      const output = await run(tools.show_destination_card, { ...capVert, destinationId });
      expect(output).toMatchObject({ ok: true, card: { destinationId } });
    });

    // Fails if matching becomes a bare substring test: « Oman » is inside « romantique ».
    it("does not match a destination name inside another word", async () => {
      const { tools } = familySetup();
      await run(tools.search_web, {
        query: "séjour romantique vaccins",
        topic: "health_formalities",
      });
      const output = await run(tools.show_destination_card, { ...capVert, destinationId: "OM" });
      expect(output).toMatchObject({ ok: false, error: { errorCategory: "business" } });
    });

    // Fails if the gate leaks onto trips without children.
    it("leaves a card for a couple unaffected", async () => {
      const state = createState();
      state.brief = decidedBrief;
      state.searchUrls.add("https://example.org/climat");
      const output = await run(setup(state).tools.show_destination_card, capVert);
      expect(output).toMatchObject({ ok: true, card: { destinationId: "CV" } });
    });
  });

  it("show_destination_card refuses a why over 280 characters or a fourth highlight", async () => {
    const state = createState();
    state.searchUrls.add("https://climat.test/vietnam");
    const { tools } = setup(state);
    const card = {
      destinationId: "VN",
      region: "Asie du Sud-Est",
      why: "Baie d'Halong et rizières en terrasses",
      bestPeriod: "novembre",
      highlights: ["Baie d'Halong"],
      alerts: [],
      sources: [{ title: "Climat", url: "https://climat.test/vietnam" }],
      coordinates: { lat: 16, lng: 107.9 },
      flightTimeFromParis: "12 h",
      travelBetter: "La baie de Lan Ha, voisine, reçoit moins de bateaux.",
    };
    expect(destinationCardInputSchema.safeParse({ ...card, why: "a".repeat(281) }).success).toBe(
      false,
    );
    expect(
      destinationCardInputSchema.safeParse({ ...card, highlights: ["a", "b", "c", "d"] }).success,
    ).toBe(false);
    expect(destinationCardInputSchema.safeParse(card).success).toBe(true);
    await expect(run(tools.show_destination_card, card)).resolves.toMatchObject({ ok: true });
  });

  // Fails if either spine field goes optional again: the card renders its blocks
  // unconditionally so that two cards of a turn share their row grid, and a missing row would
  // put every block below it one row apart from its counterpart.
  it("show_destination_card refuses a card whose comparison spine is incomplete", () => {
    const { region, flightTimeFromParis, ...spineless } = card;
    expect(
      destinationCardInputSchema.safeParse({ ...spineless, flightTimeFromParis }).success,
    ).toBe(false);
    expect(destinationCardInputSchema.safeParse({ ...spineless, region }).success).toBe(false);
    expect(
      destinationCardInputSchema.safeParse({ ...card, bestPeriod: "a".repeat(81) }).success,
    ).toBe(false);
    expect(destinationCardInputSchema.safeParse(card).success).toBe(true);
  });

  it("refuses a non-http scheme in every URL the UI renders as a link", () => {
    const href = "javascript:alert(1)";
    expect(
      destinationCardInputSchema.safeParse({ ...card, sources: [{ title: "x", url: href }] })
        .success,
    ).toBe(false);
    expect(
      searchOutcomeSchema.safeParse({
        ok: true,
        results: [{ title: "x", url: href, domain: "x", snippet: "s" }],
      }).success,
    ).toBe(false);
    expect(
      tripBriefPatchSchema.safeParse({
        feasibilityAlerts: [{ kind: "season", message: "Mousson", sources: [href] }],
      }).success,
    ).toBe(false);
    expect(
      tripBriefPatchSchema.safeParse({
        feasibilityAlerts: [
          { kind: "season", message: "Mousson", sources: ["https://climat.test/a"] },
        ],
      }).success,
    ).toBe(true);
  });

  it("propose_quote_request sends only the matching ready version and promotes mandatory fields to confirmed", async () => {
    const state = createState();
    state.brief = decidedBrief;
    const { tools } = setup(state);
    const stale = await run(tools.propose_quote_request, { briefVersion: "0000000000000000" });
    expect(stale).toMatchObject({ ok: false, error: { errorCategory: "business" } });

    const sent = await run(tools.propose_quote_request, {
      briefVersion: briefVersion(decidedBrief),
    });
    if (!sent.ok) throw new Error("expected propose_quote_request to succeed");
    expect(sent.brief.destination?.status).toBe("confirmed");
    expect(sent.brief.dates?.status).toBe("confirmed");
    expect(sent.brief.duration?.status).toBe("confirmed");
    expect(sent.brief.travelers?.status).toBe("confirmed");
    expect(sent.brief.budget?.status).toBe("confirmed");
    expect(sent.brief.departureCountry?.status).toBe("inferred");
    expect(sent.agencyText).toContain("Viêt Nam");
    expect(state.brief.destination?.status).toBe("confirmed");
    expect(state.brief.travelers?.status).toBe("confirmed");
  });

  it("update_trip_brief refuses an alert source that no search returned", async () => {
    const { tools } = setup();
    const result = await run(tools.update_trip_brief, {
      feasibilityAlerts: [
        { kind: "season", message: "Mousson en juillet", sources: ["https://ailleurs.test/a"] },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { errorCategory: "validation", message: expect.stringContaining("ailleurs.test") },
    });
  });

  it("update_trip_brief accepts an alert source a search returned", async () => {
    const state = createState();
    state.searchUrls.add("https://climat.test/vietnam");
    const { tools } = setup(state);
    const result = await run(tools.update_trip_brief, {
      feasibilityAlerts: [
        { kind: "season", message: "Mousson en juillet", sources: ["https://climat.test/vietnam"] },
      ],
    });
    expect(result).toMatchObject({ ok: true });
  });

  // Fails if a guide gate survives on the send: a ready family brief needs nothing loaded.
  it("propose_quote_request sends a ready family brief", async () => {
    const state = createState();
    state.brief = familyBriefWithChild;
    const { tools } = setup(state);
    const sent = await run(tools.propose_quote_request, {
      briefVersion: briefVersion(state.brief),
    });
    expect(sent).toMatchObject({ ok: true });
  });
});
