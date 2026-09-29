import { describe, expect, it } from "vitest";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { ChatUIMessage, ToolPart } from "@/lib/agent/types";
import {
  answerPendingQuestions,
  canRequestRecap,
  briefForVersion,
  latestBrief,
  newFeasibilityAlerts,
  panelBrief,
  pendingQuestions,
  searchDisplay,
  shouldSendAutomatically,
  statusLabel,
} from "@/lib/chat/client-state";
import { confirmMandatoryFields } from "@/lib/brief/merge";
import { decidedBrief } from "../brief/fixtures";
import { assistant, user } from "../agent/messages";

const question = (toolCallId: string, state = "input-available") =>
  ({
    type: "tool-ask_traveler",
    toolCallId,
    state,
    input: {
      question: "Avec qui ?",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      multiSelect: false,
    },
    ...(state === "output-available" ? { output: { selected: ["a"] } } : {}),
  }) as ChatUIMessage["parts"][number];

const briefPart = (version: string, brief = decidedBrief) =>
  ({
    type: "tool-update_trip_brief",
    toolCallId: `u-${version}`,
    state: "output-available",
    input: {},
    output: { ok: true, brief, version, missingForRecap: [] },
  }) as ChatUIMessage["parts"][number];

describe("pending questions", () => {
  it("finds unanswered questions in the last assistant message only", () => {
    const messages = [
      assistant("1", [question("old")]),
      user("2", "x"),
      assistant("3", [question("answered", "output-available"), question("q1")]),
    ];
    expect(pendingQuestions(messages).map((q) => q.toolCallId)).toEqual(["q1"]);
  });

  it("answers the first question and errors the extra ones", () => {
    const messages = [assistant("1", [question("q1"), question("q2")])];
    expect(answerPendingQuestions(messages, { freeText: "en couple" })).toEqual([
      { toolCallId: "q2", errorText: "Une seule question à la fois." },
      { toolCallId: "q1", output: { freeText: "en couple" } },
    ]);
  });

  it("returns nothing when no question is pending", () => {
    expect(answerPendingQuestions([user("1", "x")], { selected: ["a"] })).toEqual([]);
  });
});

describe("brief helpers", () => {
  it("returns the latest brief and a brief by version", () => {
    const laterBrief = { ...decidedBrief, interests: ["plage"] };
    const messages = [
      assistant("1", [briefPart("aaaaaaaaaaaaaaaa")]),
      assistant("2", [briefPart("bbbbbbbbbbbbbbbb", laterBrief)]),
    ];
    expect(latestBrief(messages)?.version).toBe("bbbbbbbbbbbbbbbb");
    expect(briefForVersion(messages, "aaaaaaaaaaaaaaaa")).toEqual(decidedBrief);
    expect(briefForVersion(messages, "bbbbbbbbbbbbbbbb")).toEqual(laterBrief);
    expect(briefForVersion(messages, "cccccccccccccccc")).toBeUndefined();
  });

  // Fails if the panel reads the last update_trip_brief after a send: it predates the approval, so
  // the period would stay « À vérifier » beside a sent JSON that says "confirmed".
  it("gives the panel the sent brief or the latest update, whichever comes last", () => {
    const sentBrief = confirmMandatoryFields(decidedBrief);
    const send = (ok: boolean) =>
      ({
        type: "tool-propose_quote_request",
        toolCallId: "q1",
        state: "output-available",
        input: { briefVersion: "aaaaaaaaaaaaaaaa" },
        output: ok ? { ok: true, brief: sentBrief, agencyText: "" } : { ok: false },
      }) as unknown as ChatUIMessage["parts"][number];
    const recorded = assistant("1", [briefPart("aaaaaaaaaaaaaaaa")]);

    expect(panelBrief([recorded])?.dates?.status).toBe("inferred");
    expect(panelBrief([recorded, assistant("2", [send(false)])])).toEqual(decidedBrief);

    const panel = panelBrief([recorded, assistant("2", [send(true)])]);
    expect(panel?.dates?.status).toBe("confirmed");
    expect(panel?.departureCountry?.status).toBe("inferred");
    expect(panelBrief([])).toBeUndefined();

    // Fails if the sent brief outranks a correction typed after the send: the composer stays
    // enabled, and the panel would keep showing what the recap buttons no longer read.
    const corrected = { ...sentBrief, interests: ["randonnée"] };
    const afterSend = [
      recorded,
      assistant("2", [send(true)]),
      user("3", "Finalement, plutôt de la randonnée"),
      assistant("4", [briefPart("bbbbbbbbbbbbbbbb", corrected)]),
    ];
    expect(panelBrief(afterSend)).toEqual(corrected);
  });

  it("returns only the alerts a brief update added, and none for an unknown call", () => {
    const alert = (message: string) => ({ kind: "season" as const, message, sources: [] });
    const first = { ...decidedBrief, feasibilityAlerts: [alert("Mousson en juillet")] };
    const second = {
      ...decidedBrief,
      feasibilityAlerts: [alert("Mousson en juillet"), alert("Budget serré")],
    };
    const messages = [
      assistant("1", [briefPart("aaaaaaaaaaaaaaaa", first)]),
      assistant("2", [briefPart("bbbbbbbbbbbbbbbb", second)]),
    ];

    expect(newFeasibilityAlerts(messages, "u-aaaaaaaaaaaaaaaa")).toEqual([
      alert("Mousson en juillet"),
    ]);
    expect(newFeasibilityAlerts(messages, "u-bbbbbbbbbbbbbbbb")).toEqual([alert("Budget serré")]);
    expect(newFeasibilityAlerts(messages, "u-inconnu")).toEqual([]);
  });
});

const searchPart = (state: string) =>
  ({
    type: "tool-search_web",
    toolCallId: "s",
    state,
    input: { query: "q", topic: "general" },
    ...(state === "output-available" ? { output: { ok: true, results: [] } } : {}),
  }) as ChatUIMessage["parts"][number];

describe("statusLabel", () => {
  it("shows a pending label before the first token and a tool label while a tool runs", () => {
    expect(statusLabel([user("1", "x")], "submitted")).toEqual({
      text: "Réponse en cours…",
      visible: true,
    });
    // The input is still partial while it streams, so the label falls back until the query lands.
    const streaming = assistant("2", [
      { type: "tool-search_web", toolCallId: "s", state: "input-streaming", input: {} },
    ] as ChatUIMessage["parts"]);
    expect(statusLabel([streaming], "streaming")).toEqual({
      text: "Recherche en cours…",
      visible: true,
    });
  });

  it("keeps a pending label between a finished tool and the first token", () => {
    const afterTool = assistant("2", [searchPart("output-available")]);
    expect(statusLabel([afterTool], "streaming")).toEqual({
      text: "Réponse en cours…",
      visible: true,
    });
    const withText = assistant("2", [
      searchPart("output-available"),
      { type: "text", text: "Le Cap-Vert" },
    ] as ChatUIMessage["parts"]);
    expect(statusLabel([withText], "streaming")).toBeUndefined();
  });

  it("keeps the pending label after a tool finishes even when the turn already wrote text", () => {
    const message = assistant("2", [
      { type: "text", text: "Je vérifie la saison." },
      searchPart("output-available"),
    ] as ChatUIMessage["parts"]);
    expect(statusLabel([message], "streaming")).toEqual({
      text: "Réponse en cours…",
      visible: true,
    });
  });

  it("names what is being searched", () => {
    const search = assistant("2", [searchPart("input-available")]);
    expect(statusLabel([search], "streaming")?.text).toBe("Recherche\u00a0: q");
  });

  it("falls back instead of typing out a partially streamed search query", () => {
    const search = assistant("2", [
      {
        type: "tool-search_web",
        toolCallId: "s",
        state: "input-streaming",
        input: { query: "meil" },
      },
    ] as ChatUIMessage["parts"]);
    expect(statusLabel([search], "streaming")?.text).toBe("Recherche en cours…");
  });

  it("announces the finished turn and any pending question without showing it", () => {
    const answered = assistant("2", [{ type: "text", text: "Voici." }] as ChatUIMessage["parts"]);
    expect(statusLabel([answered], "ready")).toEqual({ text: "Réponse reçue.", visible: false });
    expect(statusLabel([assistant("3", [question("q1")])], "ready")).toEqual({
      text: "Une question vous attend\u00a0: Avec qui ?",
      visible: false,
    });
    expect(statusLabel([user("1", "x")], "ready")).toBeUndefined();
  });

  it("announces a pending recap approval instead of the generic reply line", () => {
    const proposal = assistant("2", [
      {
        type: "tool-propose_quote_request",
        toolCallId: "q1",
        state: "approval-requested",
        input: { briefVersion: "aaaaaaaaaaaaaaaa" },
        approval: { id: "a1" },
      },
    ] as ChatUIMessage["parts"]);
    expect(statusLabel([proposal], "ready")).toEqual({
      text: "Votre récapitulatif est prêt à vérifier avant envoi.",
      visible: false,
    });
  });
});

describe("searchDisplay", () => {
  const hit = (url: string, title = "t") => ({
    title,
    url,
    domain: "exemple.test",
    snippet: "s",
  });
  const part = (state: string, output?: unknown) =>
    ({
      type: "tool-search_web",
      toolCallId: "s1",
      state,
      input: { query: "VN", topic: "general" },
      output,
    }) as unknown as ToolPart<"search_web">;

  it("shows nothing while the input is still streaming", () => {
    expect(searchDisplay(part("input-streaming"))).toEqual({ kind: "none" });
  });

  it("shows nothing when the search returned no result", () => {
    expect(searchDisplay(part("output-available", { ok: true, results: [] }))).toEqual({
      kind: "none",
    });
  });

  it("deduplicates repeated URLs, keeping the first title, and carries the query", () => {
    const result = searchDisplay(
      part("output-available", {
        ok: true,
        results: [hit("https://a.test/x", "premier"), hit("https://a.test/x", "second")],
      }),
    );
    expect(result).toEqual({
      kind: "sources",
      query: "VN",
      sources: [
        { title: "premier", url: "https://a.test/x", domain: "exemple.test", snippet: "s" },
      ],
    });
  });

  it("reports a failure for a tool error and for an output error alike", () => {
    expect(searchDisplay(part("output-available", { ok: false, error: {} }))).toEqual({
      kind: "failed",
    });
    expect(searchDisplay(part("output-error"))).toEqual({ kind: "failed" });
  });
});

describe("canRequestRecap", () => {
  const briefPart = (missing: string[]) =>
    ({
      type: "tool-update_trip_brief",
      toolCallId: "u1",
      state: "output-available",
      input: {},
      output: {
        ok: true,
        brief: decidedBrief,
        version: "aaaaaaaaaaaaaaaa",
        missingForRecap: missing,
      },
    }) as unknown as ChatUIMessage["parts"][number];

  const proposal = (state: string, ok = true) =>
    ({
      type: "tool-propose_quote_request",
      toolCallId: "q1",
      state,
      input: { briefVersion: "aaaaaaaaaaaaaaaa" },
      ...(state === "approval-requested"
        ? { approval: { id: "a1" } }
        : { output: ok ? { ok: true, brief: decidedBrief, agencyText: "" } : { ok: false } }),
    }) as unknown as ChatUIMessage["parts"][number];

  it("stays closed while nothing has been collected", () => {
    expect(canRequestRecap([])).toBe(false);
  });

  it("stays closed while the server still reports a missing field", () => {
    expect(canRequestRecap([assistant("2", [briefPart(["duration"])])])).toBe(false);
  });

  it("opens once the server reports nothing missing", () => {
    expect(canRequestRecap([assistant("2", [briefPart([])])])).toBe(true);
  });

  it("closes again while a recap is on screen and once the brief has been sent", () => {
    const pending = [assistant("2", [briefPart([]), proposal("approval-requested")])];
    expect(canRequestRecap(pending)).toBe(false);
    const sent = [assistant("2", [briefPart([]), proposal("output-available")])];
    expect(canRequestRecap(sent)).toBe(false);
  });

  // Fails if the pending check scans the whole history: a recap the traveller wrote past would keep
  // "Voir le récapitulatif" hidden for the rest of the conversation.
  it("opens again once the traveller has written past a recap", () => {
    const writtenPast = [
      assistant("2", [briefPart([]), proposal("approval-requested")]),
      user("3", "Finalement deux semaines"),
      assistant("4", [briefPart([])]),
    ];
    expect(canRequestRecap(writtenPast)).toBe(true);
  });

  it("stays open after a refused send, so the traveller can ask again", () => {
    const refused = [assistant("2", [briefPart([]), proposal("output-available", false)])];
    expect(canRequestRecap(refused)).toBe(true);
  });
});

describe("shouldSendAutomatically", () => {
  const proposal = (state: string, ok = true) =>
    ({
      type: "tool-propose_quote_request",
      toolCallId: "q1",
      state,
      input: { briefVersion: "aaaaaaaaaaaaaaaa" },
      ...(state === "approval-responded"
        ? { approval: { id: "a1", approved: true } }
        : { output: ok ? { ok: true, brief: decidedBrief, agencyText: "" } : { ok: false } }),
    }) as unknown as ChatUIMessage["parts"][number];

  // Fails if the guard is dropped: the SDK helper below is true on a sent brief, so the client
  // would post the conversation again and the model would comment on a demande already gone.
  it("stops after a successful send, where the SDK helper alone would re-send", () => {
    const sent = [user("1", "Envoie"), assistant("2", [proposal("output-available")])];
    expect(lastAssistantMessageIsCompleteWithToolCalls({ messages: sent })).toBe(true);
    expect(shouldSendAutomatically({ messages: sent })).toBe(false);
  });

  it("sends the approval response, and sends again after a refused send", () => {
    const approved = [
      user("1", "Envoie"),
      assistant("2", [
        { type: "step-start" } as ChatUIMessage["parts"][number],
        proposal("approval-responded"),
      ]),
    ];
    expect(shouldSendAutomatically({ messages: approved })).toBe(true);
    const refused = [user("1", "Envoie"), assistant("2", [proposal("output-available", false)])];
    expect(shouldSendAutomatically({ messages: refused })).toBe(true);
  });

  it("sends an answered question, and waits while one is pending", () => {
    const answered = [user("1", "?"), assistant("2", [question("q1", "output-available")])];
    expect(shouldSendAutomatically({ messages: answered })).toBe(true);
    const pending = [user("1", "?"), assistant("2", [question("q1")])];
    expect(shouldSendAutomatically({ messages: pending })).toBe(false);
  });
});
