import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import type { ChatUIMessage, ToolPart } from "@/lib/agent/types";
import type { MissingItem } from "@/lib/brief/readiness";
import type { TripBrief } from "@/lib/brief/schema";

export type Source = { url: string; domain: string; title?: string };

export type SearchDisplay =
  { kind: "none" } | { kind: "failed" } | { kind: "sources"; query: string; sources: Source[] };

// A search is shown where it happened rather than gathered at the end of the turn: the part always
// precedes the cards and the buttons it feeds, so the reading order comes out right on its own.
export function searchDisplay(part: ToolPart<"search_web">): SearchDisplay {
  if (part.state === "output-error") return { kind: "failed" };
  if (part.state !== "output-available") return { kind: "none" };
  if (!part.output.ok) return { kind: "failed" };
  const seen = new Set<string>();
  const sources = part.output.results.filter((hit) => !seen.has(hit.url) && seen.add(hit.url));
  return sources.length > 0
    ? { kind: "sources", query: part.input.query, sources }
    : { kind: "none" };
}

type Answer = { selected: string[] } | { freeText: string };

export type ToolOutputCall = { toolCallId: string } & ({ output: Answer } | { errorText: string });

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

const PENDING_STATUS = "Réponse en cours…";

const TOOL_STATUS: Partial<Record<ChatUIMessage["parts"][number]["type"], string>> = {
  "tool-search_web": "Recherche en cours…",
  "tool-show_destination_card": "Préparation de la fiche destination…",
  "tool-update_trip_brief": "Mise à jour de votre voyage…",
  "tool-propose_quote_request": "Préparation du récapitulatif…",
};

const parts = (messages: ChatUIMessage[]) => messages.flatMap((message) => message.parts);

export type PendingQuestion = Extract<ToolPart<"ask_traveler">, { state: "input-available" }>;

export function pendingQuestions(messages: ChatUIMessage[]): PendingQuestion[] {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return [];
  return last.parts.filter(
    (part): part is PendingQuestion =>
      part.type === "tool-ask_traveler" && part.state === "input-available",
  );
}

export type PendingApproval = Extract<
  ToolPart<"propose_quote_request">,
  { state: "approval-requested" }
>;

// Only the last message's recap can still be answered: once the traveller writes past a recap, the
// server resolves it as refused (lib/agent/conversation.ts) and its buttons would answer nothing.
export function pendingApproval(messages: ChatUIMessage[]): PendingApproval | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return undefined;
  return last.parts.find(
    (part): part is PendingApproval =>
      part.type === "tool-propose_quote_request" && part.state === "approval-requested",
  );
}

export function answerPendingQuestions(
  messages: ChatUIMessage[],
  answer: Answer,
): ToolOutputCall[] {
  const [first, ...extra] = pendingQuestions(messages);
  if (!first) return [];
  return [
    ...extra.map((part) => ({
      toolCallId: part.toolCallId,
      errorText: "Une seule question à la fois.",
    })),
    { toolCallId: first.toolCallId, output: answer },
  ];
}

function briefOutputs(messages: ChatUIMessage[]) {
  return parts(messages).flatMap((part) =>
    part.type === "tool-update_trip_brief" && part.state === "output-available" && part.output.ok
      ? [
          {
            brief: part.output.brief,
            version: part.output.version,
            missingForRecap: part.output.missingForRecap,
          },
        ]
      : [],
  );
}

export function latestBrief(messages: ChatUIMessage[]) {
  return briefOutputs(messages).at(-1);
}

// Approving the recap promotes the mandatory fields to confirmed server-side, and that brief only
// exists in the send's output: the last update_trip_brief predates it, so reading that one after a
// send would show "À vérifier" beside a field the sent JSON calls confirmed. A correction typed
// after the send is newer still, so whichever of the two comes last wins.
export function panelBrief(messages: ChatUIMessage[]): TripBrief | undefined {
  const briefs = parts(messages).flatMap((part) =>
    (part.type === "tool-propose_quote_request" || part.type === "tool-update_trip_brief") &&
    part.state === "output-available" &&
    part.output.ok
      ? [part.output.brief]
      : [],
  );
  return briefs.at(-1);
}

export function newFeasibilityAlerts(
  messages: ChatUIMessage[],
  toolCallId: string,
): TripBrief["feasibilityAlerts"] {
  let previous: TripBrief["feasibilityAlerts"] = [];
  for (const part of parts(messages)) {
    if (part.type !== "tool-update_trip_brief" || part.state !== "output-available") continue;
    if (!part.output.ok) continue;
    if (part.toolCallId === toolCallId) {
      const seen = new Set(previous.map((alert) => alert.message));
      return part.output.brief.feasibilityAlerts.filter((alert) => !seen.has(alert.message));
    }
    previous = part.output.brief.feasibilityAlerts;
  }
  return [];
}

export function briefForVersion(messages: ChatUIMessage[], version: string): TripBrief | undefined {
  return briefOutputs(messages).find((entry) => entry.version === version)?.brief;
}

export type ChatStatusMessage = { text: string; visible: boolean };

// Says what is running, not just that something is: the query is on the part already, and "Recherche en cours…" three times in a row tells the traveller nothing.
function runningLabel(part: ChatUIMessage["parts"][number]): string {
  const fallback = TOOL_STATUS[part.type] ?? PENDING_STATUS;
  if (part.type === "tool-search_web") {
    if (part.state !== "input-available") return fallback;
    return `Recherche\u00a0: ${part.input.query}`;
  }
  return fallback;
}

export function statusLabel(
  messages: ChatUIMessage[],
  status: ChatStatus,
): ChatStatusMessage | undefined {
  if (status === "submitted") return { text: PENDING_STATUS, visible: true };
  if (status === "streaming") {
    const last = messages.at(-1);
    const running = last?.parts.findLast(
      (part) =>
        part.type in TOOL_STATUS &&
        "state" in part &&
        typeof part.state === "string" &&
        part.state.startsWith("input-"),
    );
    if (running) return { text: runningLabel(running), visible: true };
    // Decide on the last part, not on whether the turn wrote text at all: a tool that has just
    // returned means the next step has not spoken yet, and the line must not blank out meanwhile.
    if (last?.parts.at(-1)?.type === "text") return undefined;
    return { text: PENDING_STATUS, visible: true };
  }
  if (status === "ready") {
    const pending = pendingQuestions(messages)[0];
    if (pending)
      return { text: `Une question vous attend : ${pending.input.question}`, visible: false };
    if (messages.at(-1)?.role !== "assistant") return undefined;
    if (pendingApproval(messages))
      return { text: "Votre récapitulatif est prêt à vérifier avant envoi.", visible: false };
    return { text: "Réponse reçue.", visible: false };
  }
  return undefined;
}

function briefWasSent(messages: ChatUIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  return last.parts.some(
    (part) =>
      part.type === "tool-propose_quote_request" &&
      part.state === "output-available" &&
      part.output.ok,
  );
}

// The sent card is the end of the conversation, and the turn that sends returns no text of its own
// (see lib/agent/chat.ts). Without this guard `lastAssistantMessageIsCompleteWithToolCalls` sees a
// last step whose only tool call has an output and posts the conversation once more, which is the
// one turn where the model has nothing left to say and says it anyway.
export function shouldSendAutomatically(options: { messages: ChatUIMessage[] }): boolean {
  if (briefWasSent(options.messages)) return false;
  return (
    lastAssistantMessageIsCompleteWithToolCalls(options) ||
    lastAssistantMessageIsCompleteWithApprovalResponses(options)
  );
}

export function missingForRecap(messages: ChatUIMessage[]): MissingItem[] {
  return briefOutputs(messages).at(-1)?.missingForRecap ?? [];
}

// The traveller can ask for the recap once the server says nothing is missing, and only while no
// recap is already on screen and nothing has been sent. The button never sends: it asks the agent
// to propose, so the recap stays the one place the brief is reviewed before an agency sees it.
export function canRequestRecap(messages: ChatUIMessage[]): boolean {
  const outputs = briefOutputs(messages);
  if (outputs.length === 0 || (outputs.at(-1)?.missingForRecap.length ?? 1) > 0) return false;
  if (pendingApproval(messages)) return false;
  return !parts(messages).some(
    (part) =>
      part.type === "tool-propose_quote_request" &&
      part.state === "output-available" &&
      part.output.ok,
  );
}
