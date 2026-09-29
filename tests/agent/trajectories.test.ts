import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import {
  APICallError,
  readUIMessageStream,
  simulateReadableStream,
  type InferUIMessageChunk,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createChatResponse, MAX_STEPS } from "@/lib/agent/chat";
import { prepareModelMessages, TYPED_REPLY_REASON } from "@/lib/agent/conversation";
import { createState } from "@/lib/agent/state";
import { createTools } from "@/lib/agent/tools";
import { GENERIC_STREAM_ERROR_MESSAGE, RATE_LIMITED_MESSAGE } from "@/lib/agent/stream-errors";
import type { ChatUIMessage } from "@/lib/agent/types";
import { briefVersion } from "@/lib/brief/version";
import { decidedBrief, decidedPatch, familyBrief, familyPatch } from "../brief/fixtures";
import { assistant, user } from "./messages";

const today = new Date("2026-09-17T10:00:00Z");
const search = async () => ({ ok: true as const, results: [] });

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function toolCall(id: string, toolName: string, input: unknown): LanguageModelV4StreamPart[] {
  const json = JSON.stringify(input);
  return [
    { type: "tool-input-start", id, toolName },
    { type: "tool-input-delta", id, delta: json },
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input: json },
  ];
}

function text(delta: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta },
    { type: "text-end", id: "t" },
  ];
}

/** A model that plays one scripted step per call, like a real multi-step turn. */
function scriptedModel(...steps: LanguageModelV4StreamPart[][]) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const parts = steps[Math.min(step, steps.length - 1)] ?? [];
      step += 1;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            ...parts,
            {
              type: "finish",
              finishReason: {
                unified: parts.some((c) => c.type === "tool-call") ? "tool-calls" : "stop",
                raw: "end_turn",
              },
              usage,
            },
          ],
        }),
      };
    },
  });
}

const briefUpdate = (input: unknown, version: string): ChatUIMessage["parts"][number] =>
  ({
    type: "tool-update_trip_brief",
    toolCallId: "u1",
    state: "output-available",
    input,
    output: { ok: true, brief: {}, version, missingForRecap: [] },
  }) as unknown as ChatUIMessage["parts"][number];

const loadedGuide = (guide: string): ChatUIMessage["parts"][number] =>
  ({
    type: "tool-load_guide",
    toolCallId: "g1",
    state: "output-available",
    input: { guide },
    output: { ok: true, guide, content: "..." },
  }) as unknown as ChatUIMessage["parts"][number];

const searched = (query: string, urls: string[]): ChatUIMessage["parts"][number] =>
  ({
    type: "tool-search_web",
    toolCallId: "s1",
    state: "output-available",
    input: { query, topic: "general" },
    output: {
      ok: true,
      results: urls.map((url) => ({
        title: "Climat",
        url,
        domain: new URL(url).hostname,
        snippet: "…",
      })),
    },
  }) as unknown as ChatUIMessage["parts"][number];

/**
 * A denial is the server's: the SDK emits `isAutomatic: true` with an immediate
 * `tool-approval-response`. When the gate lets the call through it emits a plain
 * `tool-approval-request` and stops the turn, so the traveller confirms in the UI.
 */
function approvalOutcome(parts: Record<string, unknown>[]) {
  const request = parts.find((c) => c.type === "tool-approval-request");
  const response = parts.find((c) => c.type === "tool-approval-response");
  return {
    decidedByServer: request?.isAutomatic === true,
    handedToTraveller: request !== undefined && request.isAutomatic === undefined,
    reason: response?.reason as string | undefined,
    denied: parts.some((c) => c.type === "tool-output-denied"),
  };
}

async function run(messages: unknown[], model: MockLanguageModelV4) {
  const response = await createChatResponse(messages, { model, search, today });
  return { response, body: await response.text() };
}

function chunks(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

const sendAttempt = (version: string) =>
  toolCall("q1", "propose_quote_request", { briefVersion: version });

const respondedSend = (
  version: string,
  approval: Record<string, unknown>,
): ChatUIMessage["parts"][number] =>
  ({
    type: "tool-propose_quote_request",
    toolCallId: "q1",
    state: "approval-responded",
    input: { briefVersion: version },
    approval: { id: "a1", ...approval },
  }) as unknown as ChatUIMessage["parts"][number];

const pendingSend = (version: string): ChatUIMessage["parts"][number] =>
  ({
    type: "tool-propose_quote_request",
    toolCallId: "q1",
    state: "approval-requested",
    input: { briefVersion: version },
    approval: { id: "a1" },
  }) as unknown as ChatUIMessage["parts"][number];

const approvedSend = (version: string) => respondedSend(version, { approved: true });

const refusedSend = (version: string, reason: string) =>
  respondedSend(version, { approved: false, reason });

describe("the send gate stops an unusable brief", () => {
  // Fails if toolApproval is dropped from streamText, or approvalFor stops being wired to it:
  // the tool would then execute and the traveller would send an empty brief to an agency.
  it("denies an empty brief and names all four mandatory fields", async () => {
    const { body } = await run(
      [user("1", "Envoie ma demande à une agence")],
      scriptedModel(sendAttempt("0000000000000000"), text("Il me manque des informations.")),
    );
    const parts = chunks(body);

    const outcome = approvalOutcome(parts);
    expect(outcome.decidedByServer).toBe(true);
    expect(outcome.reason).toContain("la destination");
    expect(outcome.reason).toContain("la période du voyage");
    expect(outcome.reason).toContain("la durée");
    expect(outcome.reason).toContain("les voyageurs");
    expect(outcome.denied).toBe(true);
    expect(parts.some((c) => c.type === "tool-output-available")).toBe(false);
  });

  // Fails if the version check leaves sendDenial: the traveller would approve a recap and send a
  // brief that changed under it.
  it("denies a complete brief approved at a stale version", async () => {
    const { body } = await run(
      [
        user("1", "Vietnam, 3 semaines en novembre, on est 2"),
        assistant("2", [briefUpdate(decidedPatch, briefVersion(decidedBrief))]),
        user("3", "Envoie"),
      ],
      scriptedModel(sendAttempt("0000000000000000"), text("Je reprends le récapitulatif.")),
    );
    const outcome = approvalOutcome(chunks(body));
    expect(outcome.denied).toBe(true);
    expect(outcome.reason).toContain(briefVersion(decidedBrief));
  });

  // Fails if familyGuideMissing stops gating the send: a family trip would be sent to an agency
  // without the child-specific attentions the guide requires.
  it("denies a family brief until the family guide has been loaded", async () => {
    const history = [
      user("1", "Vietnam en novembre, 3 semaines, avec notre fils de 6 ans"),
      assistant("2", [briefUpdate(familyPatch, briefVersion(familyBrief))]),
      user("3", "Envoie"),
    ];
    const denied = await run(
      history,
      scriptedModel(sendAttempt(briefVersion(familyBrief)), text("Un instant.")),
    );
    const deniedParts = chunks(denied.body);
    const outcome = approvalOutcome(deniedParts);
    expect(outcome.denied).toBe(true);
    expect(outcome.reason).toContain("family_travel");
    expect(deniedParts.some((c) => c.type === "error")).toBe(false);

    const withGuide = await run(
      [
        history[0],
        assistant("2", [
          briefUpdate(familyPatch, briefVersion(familyBrief)),
          loadedGuide("family_travel"),
        ]),
        history[2],
      ],
      scriptedModel(sendAttempt(briefVersion(familyBrief)), text("C'est envoyé.")),
    );
    expect(approvalOutcome(chunks(withGuide.body))).toMatchObject({
      handedToTraveller: true,
      denied: false,
    });
  });

  // Fails if show_destination_card stops checking the guides: the agent would recommend a
  // destination to a family before reading the attentions that apply to children.
  it("refuses a destination card for a family brief before the family guide is loaded", async () => {
    const card = {
      destinationId: "VN",
      region: "Asie du Sud-Est",
      why: "Baie d'Halong et rizières",
      bestPeriod: "novembre",
      highlights: ["Baie d'Halong"],
      alerts: [],
      sources: [{ title: "Climat au Vietnam", url: "https://example.org/vietnam" }],
      coordinates: { lat: 16.0, lng: 107.9 },
      flightTimeFromParis: "12 h",
    };
    const { body } = await run(
      [
        user("1", "Vietnam en novembre, 3 semaines, avec notre fils de 6 ans"),
        assistant("2", [briefUpdate(familyPatch, briefVersion(familyBrief))]),
        user("3", "Montre-moi à quoi ça ressemble"),
      ],
      scriptedModel(toolCall("c1", "show_destination_card", card), text("Un instant.")),
    );
    const parts = chunks(body);
    const output = parts.find((c) => c.type === "tool-output-available");
    expect(output?.output).toMatchObject({
      ok: false,
      error: { errorCategory: "business", message: expect.stringContaining("family_travel") },
    });
    expect(parts.some((c) => c.type === "error")).toBe(false);
  });
});

describe("the agent loads the family guide itself", () => {
  // Fails if update_trip_brief stops returning requiredGuide, if a guide the model loads live stops
  // satisfying the send gate, or if a step forces the load: the brief leaves that decision to the
  // agent, and the gates are the guarantee.
  it("records the family, loads family_travel on its own, then reaches the send", async () => {
    const model = scriptedModel(
      toolCall("u1", "update_trip_brief", familyPatch),
      toolCall("g1", "load_guide", { guide: "family_travel" }),
      sendAttempt(briefVersion(familyBrief)),
    );
    const { body } = await run(
      [user("1", "Vietnam en novembre, 3 semaines, avec notre fils de 6 ans, budget ~4000€")],
      model,
    );
    const parts = chunks(body);
    const outputs = parts.filter((c) => c.type === "tool-output-available").map((c) => c.output);
    expect(outputs[0]).toMatchObject({ ok: true, requiredGuide: "family_travel" });
    expect(outputs[1]).toMatchObject({ ok: true, guide: "family_travel" });
    expect(approvalOutcome(parts)).toMatchObject({ handedToTraveller: true, denied: false });
    expect(model.doStreamCalls.map((call) => call.toolChoice)).toEqual([
      { type: "auto" },
      { type: "auto" },
      { type: "auto" },
    ]);
  });
});

describe("a family card waits for a health search naming the destination", () => {
  const capVert = {
    destinationId: "CV",
    region: "Afrique de l’Ouest",
    why: "La lumière de février sur la côte, et les pêcheurs qui rentrent avant midi.",
    bestPeriod: "de novembre à juin",
    highlights: ["Plages de Sal"],
    alerts: [],
    sources: [{ title: "Climat", url: "https://climat.test/cap-vert" }],
    coordinates: { lat: 16, lng: -24 },
    flightTimeFromParis: "6 h",
  };

  // Fails if the health gate goes, or if a live health search naming the destination stops
  // satisfying it: the live run that showed Cap Vert to a family after searching only the weather
  // would replay, or the card would stay refused after the search its refusal asked for. Also fails
  // if a step is forced onto search_web: the refusal guides the model, the choice stays its own.
  it("refuses the card, lets the model run the health search, then shows the card", async () => {
    const model = scriptedModel(
      toolCall("c1", "show_destination_card", capVert),
      toolCall("s2", "search_web", {
        query: "Cap-Vert paludisme vaccins enfants",
        topic: "health_formalities",
      }),
      toolCall("c3", "show_destination_card", capVert),
      text("Le Cap Vert, côté océan."),
    );
    const { body } = await run(
      [
        user("1", "Du soleil en février, avec notre fils de 6 ans"),
        assistant("2", [
          briefUpdate(familyPatch, briefVersion(familyBrief)),
          loadedGuide("family_travel"),
          loadedGuide("responsible_travel"),
          searched("soleil février", ["https://climat.test/cap-vert"]),
        ]),
        user("3", "Montrez-moi une idée"),
      ],
      model,
    );
    const outputs = chunks(body)
      .filter((c) => c.type === "tool-output-available")
      .map((c) => c.output as { ok: boolean; error?: { message: string } });
    expect(outputs[0]).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("health_formalities") },
    });
    expect(outputs[2]).toMatchObject({ ok: true });
    expect(model.doStreamCalls.map((call) => call.toolChoice)).toEqual([
      { type: "auto" },
      { type: "auto" },
      { type: "auto" },
      { type: "auto" },
    ]);
  });

  // Fails if the replay records a search before the end of its step: the AI SDK runs a step's
  // calls together, so live the card is refused, and the next turn would tell the model it showed
  // a card the traveller never saw.
  it("refuses a card that runs alongside its health search, live and on replay", async () => {
    const history = [
      user("1", "Du soleil en février, avec notre fils de 6 ans"),
      assistant("2", [
        briefUpdate(familyPatch, briefVersion(familyBrief)),
        loadedGuide("family_travel"),
        loadedGuide("responsible_travel"),
        searched("soleil février", ["https://climat.test/cap-vert"]),
      ]),
      user("3", "Montrez-moi une idée"),
    ];
    const model = scriptedModel(
      [
        ...toolCall("s1", "search_web", {
          query: "paludisme Cap Vert enfants",
          topic: "health_formalities",
        }),
        ...toolCall("c1", "show_destination_card", capVert),
      ],
      text("Je vérifie d’abord la santé."),
    );
    const { body } = await run(history, model);
    const stream = new ReadableStream<InferUIMessageChunk<ChatUIMessage>>({
      start(controller) {
        for (const chunk of chunks(body)) {
          controller.enqueue(chunk as InferUIMessageChunk<ChatUIMessage>);
        }
        controller.close();
      },
    });
    let turn: ChatUIMessage | undefined;
    for await (const message of readUIMessageStream<ChatUIMessage>({ stream })) turn = message;
    const card = (message?: ChatUIMessage) =>
      message?.parts.find((p) => p.type === "tool-show_destination_card");
    const refused = { output: { ok: false, error: { errorCategory: "business" } } };
    expect(card(turn)).toMatchObject(refused);

    const replay = [...history, turn!, user("5", "Et alors ?")];
    const tools = createTools({ state: createState(), search, today });
    const replayed = (await prepareModelMessages(replay, tools, today))
      .flatMap((message) => (message.role === "tool" ? message.content : []))
      .find((part) => part.type === "tool-result" && part.toolName === "show_destination_card");
    expect(replayed).toMatchObject({ output: { type: "json", value: refused.output } });
  });
});

describe("two destination cards carry the choice themselves", () => {
  const undecidedPatch = {
    dates: {
      value: { precision: "season", season: "hiver", year: 2027 },
      status: "confirmed",
      evidence: "cet hiver",
    },
    travelers: {
      value: { partyType: "couple", adults: 2, children: [] },
      status: "inferred",
      evidence: "on est 2",
    },
  };
  const climate = ["https://climat.test/cap-vert", "https://climat.test/sri-lanka"];
  const shortlist = (
    destinationId: string,
    region: string,
    url: string,
    flightTimeFromParis: string,
  ) => ({
    destinationId,
    region,
    why: "La lumière de février sur la côte.",
    bestPeriod: "de novembre à mai",
    highlights: ["Une côte que l’on longe à pied"],
    alerts: [],
    sources: [{ title: "Climat", url }],
    coordinates: { lat: 16.5, lng: -23.0 },
    flightTimeFromParis,
  });

  // Fails if a turn stops emitting two usable cards — a second card refused by a gate, or a card
  // whose `label` the tool no longer returns. The « Je retiens … » button lives in the card and
  // renders that label, so a turn short of one card or of one label leaves the traveller with
  // nothing to choose from. The turn also carries no `ask_traveler`: the cards are the question,
  // and a second one below them would ask it twice.
  it("emits two labelled cards and no question", async () => {
    const { body } = await run(
      [
        user("1", "On veut du soleil cet hiver mais on ne sait pas où"),
        assistant("2", [
          briefUpdate(undecidedPatch, "0000000000000000"),
          loadedGuide("responsible_travel"),
          searched("soleil en hiver", climate),
        ]),
        user("3", "Montre-moi deux idées"),
      ],
      scriptedModel(
        [
          ...toolCall(
            "c1",
            "show_destination_card",
            shortlist("CV", "Afrique de l’Ouest", climate[0], "6 h 30"),
          ),
          ...toolCall(
            "c2",
            "show_destination_card",
            shortlist("LK", "Asie du Sud", climate[1], "10 h 30"),
          ),
        ],
        text("Deux côtes, deux rythmes."),
      ),
    );
    const parts = chunks(body);
    const cards = parts
      .filter((c) => c.type === "tool-output-available")
      .map((c) => c.output as { ok: boolean; card?: { label: string } });
    expect(cards.map((c) => c.ok)).toEqual([true, true]);
    expect(cards.map((c) => c.card?.label)).toEqual(["Cap-Vert", "Sri Lanka"]);
    expect(parts.some((c) => c.type === "tool-input-start" && c.toolName === "ask_traveler")).toBe(
      false,
    );
  });
});

describe("a decided traveller reaches the send without being questioned again", () => {
  // Fails if a gate becomes stricter than the four mandatory fields — the traveller who gave
  // everything in one message would be asked for more instead of reaching the recap.
  it("hands the send decision to the traveller instead of asking for more", async () => {
    const { body } = await run(
      [
        user("1", "Vietnam, 3 semaines en novembre, on est 2, budget ~4000€"),
        assistant("2", [briefUpdate(decidedPatch, briefVersion(decidedBrief))]),
        user("3", "Oui, envoie"),
      ],
      scriptedModel(sendAttempt(briefVersion(decidedBrief)), text("C'est parti.")),
    );
    const parts = chunks(body);
    expect(approvalOutcome(parts)).toMatchObject({ handedToTraveller: true, denied: false });
    expect(parts.some((c) => c.type === "tool-input-start" && c.toolName === "ask_traveler")).toBe(
      false,
    );
  });
});

describe("a traveller who writes instead of using the recap", () => {
  // Fails if the unanswered recap reaches the model as it is: the AI SDK throws
  // MissingToolResultsError on a tool call left without a result before the next user message, and
  // "Réessayer" replays the same history, so the conversation can never resume.
  it("answers the message and hands the model the recap as refused", async () => {
    const version = briefVersion(decidedBrief);
    const model = scriptedModel(text("Trois semaines, c’est noté."));
    const { response, body } = await run(
      [
        user("1", "Vietnam, 3 semaines en novembre, on est 2, budget ~4000€"),
        assistant("2", [briefUpdate(decidedPatch, version), pendingSend(version)]),
        user("3", "Finalement plutôt deux semaines"),
      ],
      model,
    );
    expect(response.status).toBe(200);
    expect(chunks(body).some((c) => c.type === "error")).toBe(false);
    expect(body).toContain("c’est noté");
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(TYPED_REPLY_REASON);
  });
});

describe("a successful send closes the turn", () => {
  // Fails if the loop runs a text step after the send: the model introduces the card it has just
  // sent ("Voici le récapitulatif…", "prête à être envoyée"), which contradicts what happened.
  it("emits no text after a successful propose_quote_request", async () => {
    const { body } = await run(
      [
        user("1", "Vietnam, 3 semaines en novembre, on est 2, budget ~4000€"),
        assistant("2", [
          briefUpdate(decidedPatch, briefVersion(decidedBrief)),
          approvedSend(briefVersion(decidedBrief)),
        ]),
      ],
      scriptedModel(text("Voici le récapitulatif de votre voyage au Vietnam.")),
    );
    const parts = chunks(body);
    const output = parts.find((c) => c.type === "tool-output-available");
    expect(output?.output).toMatchObject({ ok: true });
    expect(parts.filter((c) => String(c.type).startsWith("text-"))).toEqual([]);
  });

  // Fails if the stop condition keys on the tool call rather than on `{ ok: true }`: a traveller
  // who abandons or asks for a change would get the sent card's silence instead of an answer.
  it("lets the model answer when the traveller refuses the send", async () => {
    const { body } = await run(
      [
        user("1", "Vietnam, 3 semaines en novembre, on est 2, budget ~4000€"),
        assistant("2", [
          briefUpdate(decidedPatch, briefVersion(decidedBrief)),
          refusedSend(briefVersion(decidedBrief), "abandon"),
        ]),
      ],
      scriptedModel(text("Je garde tout de côté. Revenez quand vous voulez.")),
    );
    const parts = chunks(body);
    expect(parts.some((c) => c.type === "tool-output-denied")).toBe(true);
    expect(body).toContain("Je garde tout de côté");
  });

  // A contract test: the sent turn writes its own chunks instead of going through
  // `toUIMessageStream`, so this replays them the way the client does. If an `ai` upgrade changes
  // how a resumed approval is merged back into its message, this fails instead of the card
  // silently never reaching the screen.
  it("reconstructs the sent card from the chunks the closing turn writes", async () => {
    const history = [
      user("1", "Vietnam, 3 semaines en novembre, on est 2, budget ~4000€"),
      assistant("2", [
        briefUpdate(decidedPatch, briefVersion(decidedBrief)),
        approvedSend(briefVersion(decidedBrief)),
      ]),
    ];
    const { body } = await run(history, scriptedModel(text("Voici le récapitulatif.")));
    const stream = new ReadableStream<InferUIMessageChunk<ChatUIMessage>>({
      start(controller) {
        for (const chunk of chunks(body)) {
          controller.enqueue(chunk as InferUIMessageChunk<ChatUIMessage>);
        }
        controller.close();
      },
    });

    let reconstructed: ChatUIMessage | undefined;
    for await (const message of readUIMessageStream<ChatUIMessage>({
      message: history[1],
      stream,
    })) {
      reconstructed = message;
    }
    expect(reconstructed?.parts.find((p) => p.type === "tool-propose_quote_request")).toMatchObject(
      {
        state: "output-available",
        output: { ok: true, brief: { destination: { status: "confirmed" } } },
      },
    );
    expect(reconstructed?.parts.some((p) => p.type === "text")).toBe(false);
  });

  // Fails if the turn ends on an approval the gate refuses: the traveller would be left with a
  // silent turn instead of being told the recap has moved on.
  it("lets the model answer when the gate refuses an approved stale version", async () => {
    const { body } = await run(
      [
        user("1", "Vietnam, 3 semaines en novembre, on est 2, budget ~4000€"),
        assistant("2", [
          briefUpdate(decidedPatch, briefVersion(decidedBrief)),
          approvedSend("0000000000000000"),
        ]),
      ],
      scriptedModel(text("Le récapitulatif a changé, je vous le repropose.")),
    );
    const parts = chunks(body);
    expect(parts.some((c) => c.type === "tool-output-denied")).toBe(true);
    expect(body).toContain("je vous le repropose");
  });
});

describe("the agent degrades without looping or crashing", () => {
  // Fails if prepareStep stops applying stepSettings: a model that keeps calling tools would run
  // past MAX_STEPS instead of being forced to answer in text.
  it("forbids tools on the last allowed step when the model keeps calling them", async () => {
    const model = scriptedModel(
      toolCall("s1", "search_web", { query: "Vietnam", topic: "general" }),
    );
    await run([user("1", "Le Vietnam en novembre ?")], model);

    expect(model.doStreamCalls.length).toBe(MAX_STEPS);
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "auto" });
    expect(model.doStreamCalls[MAX_STEPS - 1]?.toolChoice).toEqual({ type: "none" });
  });

  // Fails if a failing search starts throwing instead of returning { ok: false }: the stream would
  // break mid-answer rather than letting the model tell the traveller.
  it("passes a search failure to the model as a structured error", async () => {
    const failing = async () => ({
      ok: false as const,
      error: {
        errorCategory: "transient" as const,
        isRetryable: true,
        message: "Tavily injoignable",
      },
    });
    const response = await createChatResponse([user("1", "Le kitesurf en avril, c'est où ?")], {
      model: scriptedModel(
        toolCall("s1", "search_web", { query: "kitesurf avril", topic: "general" }),
        text("Je n'ai pas pu vérifier."),
      ),
      search: failing,
      today,
    });
    const output = chunks(await response.text()).find((c) => c.type === "tool-output-available");
    expect(output?.output).toMatchObject({
      ok: false,
      error: { errorCategory: "transient", isRetryable: true },
    });
  });

  // Fails if the onError mapping is dropped: a rate-limited traveller would see a raw provider
  // error, or the retryable case would become indistinguishable from a permanent one. Also fails if
  // the log stops carrying the error name and status code, or starts carrying the message.
  it("turns a 429 into the retry message and any other failure into the generic one", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => logged.mockRestore());
    const streamError = (error: unknown) =>
      new MockLanguageModelV4({
        doStream: {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "error", error },
            ],
          }),
        },
      });
    const apiError = (statusCode: number) =>
      new APICallError({
        message: "boom",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode,
      });

    const limited = await run([user("1", "Bonjour")], streamError(apiError(429)));
    expect(limited.body).toContain(RATE_LIMITED_MESSAGE);

    const other = await run([user("1", "Bonjour")], streamError(new Error("socket hang up")));
    expect(other.body).toContain(GENERIC_STREAM_ERROR_MESSAGE);

    expect(logged.mock.calls).toEqual([
      ["[chat]", "AI_APICallError", { statusCode: 429 }],
      ["[chat]", "Error"],
    ]);
  });
});

describe("AI SDK approval protocol", () => {
  // A contract test: the three tests above read `approved` and `reason` off a
  // tool-approval-response chunk. If an `ai` upgrade renames or reorders that protocol, this
  // fails here instead of silently making the gate assertions vacuous.
  it("emits request, response and denied output in that order for a denied call", async () => {
    const { body } = await run(
      [user("1", "Envoie")],
      scriptedModel(sendAttempt("0000000000000000"), text("Non.")),
    );
    const types = chunks(body).map((c) => c.type);
    expect(types.filter((t) => String(t).startsWith("tool-"))).toEqual([
      "tool-input-start",
      "tool-input-delta",
      "tool-input-available",
      "tool-approval-request",
      "tool-approval-response",
      "tool-output-denied",
    ]);
  });
});
