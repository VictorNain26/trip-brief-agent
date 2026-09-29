import { convertToModelMessages, pruneMessages, type ModelMessage } from "ai";
import { toolFailure } from "@/lib/agent/errors";
import {
  applyPatch,
  applySend,
  createState,
  recordPatch,
  recordSearch,
  type ConversationState,
} from "@/lib/agent/state";
import { buildDestinationCard, destinationCardFields, type createTools } from "@/lib/agent/tools";
import type { ChatPart, ChatUIMessage, ToolPart } from "@/lib/agent/types";
import { tripBriefPatchSchema } from "@/lib/brief/schema";

export const LIMITS = { maxMessages: 80, maxUserTextLength: 2000 } as const;

type ConversationCheck =
  "ok" | "system_message" | "unexpected_part" | "too_many_messages" | "message_too_long";

const ALLOWED_PART_TYPES = new Set(["text", "step-start"]);

export function checkConversation(messages: ChatUIMessage[]): ConversationCheck {
  if (messages.some((message) => message.role === "system")) return "system_message";
  // The app emits `text`, `step-start` and tool parts, and nothing else. An allowlist is the only
  // shape that holds, because several other UI part types are acted on before the model call: a
  // `file` part is fetched and buffered by this server, or handed to Anthropic to fetch, past every
  // text cap. The tool name is left open on purpose: by the time this runs, `validateUIMessages`
  // has already rewritten an unknown tool's part as a `dynamic-tool` part, which this same check
  // rejects.
  const unexpected = messages.some((message) =>
    message.parts.some(
      (part) => !ALLOWED_PART_TYPES.has(part.type) && !part.type.startsWith("tool-"),
    ),
  );
  if (unexpected) return "unexpected_part";
  if (messages.length > LIMITS.maxMessages) return "too_many_messages";
  const tooLong = messages.some(
    (message) =>
      message.role === "user" &&
      message.parts.some(
        (part) => part.type === "text" && part.text.length > LIMITS.maxUserTextLength,
      ),
  );
  return tooLong ? "message_too_long" : "ok";
}

type SearchPart = Extract<ToolPart<"search_web">, { state: "output-available" }>;

// Yields a message's parts in order, recording each search only once its step is over. Live, the
// AI SDK runs all the tool calls of a step together once the model call ends, and a search records
// its results after its own await: a card or a patch from the same step is judged without them.
// The replay has to see the searches with the same delay, or it would keep what the live tool
// refused.
function* partsInStepOrder(message: ChatUIMessage, state: ConversationState): Generator<ChatPart> {
  let pending: SearchPart[] = [];
  const recordPending = () => {
    for (const search of pending) recordSearch(state, search.input, search.output);
    pending = [];
  };
  for (const part of message.parts) {
    if (part.type === "step-start") recordPending();
    yield part;
    if (part.type === "tool-search_web" && part.state === "output-available") pending.push(part);
  }
  recordPending();
}

export function deriveConversationState(messages: ChatUIMessage[], today: Date): ConversationState {
  const state = createState();
  for (const message of messages) {
    for (const part of partsInStepOrder(message, state)) {
      if (part.type === "tool-update_trip_brief" && part.state === "output-available") {
        const patch = tripBriefPatchSchema.safeParse(part.input);
        if (patch.success) applyPatch(state, today, patch.data);
      }
      if (
        part.type === "tool-propose_quote_request" &&
        part.state === "output-available" &&
        part.output.ok
      ) {
        applySend(state);
      }
    }
  }
  return state;
}

export async function prepareModelMessages(
  messages: ChatUIMessage[],
  tools: ReturnType<typeof createTools>,
  today: Date,
): Promise<ModelMessage[]> {
  const trusted = await withTrustedToolOutputs(messages, today);
  const modelMessages = await convertToModelMessages(withToday(trusted, today), { tools });
  const pruned = pruneMessages({
    messages: modelMessages,
    toolCalls: [{ type: "before-last-6-messages", tools: ["search_web"] }],
  });
  return withCacheBreakpoint(pruned);
}

// The client resends the whole history on every turn, so a forged `update_trip_brief` or
// `show_destination_card` output (family guidance included) could otherwise reach the model
// unchanged. Replay the history against a freshly derived state and replace those two outputs with
// the recomputed, trustworthy value. `search_web`, `ask_traveler` and `propose_quote_request` outputs
// are left as the client sent them (see docs/adr/0003-stateless-brief.md).
async function withTrustedToolOutputs(
  messages: ChatUIMessage[],
  today: Date,
): Promise<ChatUIMessage[]> {
  const state = createState();
  const trusted: ChatUIMessage[] = [];
  const last = messages.length - 1;
  for (const [index, message] of messages.entries()) {
    const parts: ChatPart[] = [];
    for (const part of partsInStepOrder(message, state)) {
      const trustedPart = await trustPart(part, state, today);
      parts.push(index < last ? resolvedByTypedReply(trustedPart) : trustedPart);
    }
    trusted.push({ ...message, parts });
  }
  return trusted;
}

export const TYPED_REPLY_REASON =
  "Le voyageur a répondu par écrit au lieu d’utiliser le récapitulatif : tenez compte de son message.";

// A recap still awaiting approval before the last message means the traveller wrote instead of
// using its buttons. The AI SDK rejects a tool call left without a result or an approval response
// before the next user message (MissingToolResultsError), so the call is resolved as the refusal
// it is.
function resolvedByTypedReply(part: ChatPart): ChatPart {
  if (part.type !== "tool-propose_quote_request" || part.state !== "approval-requested") {
    return part;
  }
  return {
    ...part,
    state: "approval-responded",
    approval: { id: part.approval.id, approved: false, reason: TYPED_REPLY_REASON },
  };
}

// Provenance and the family health check are judged against the searches this replay has seen,
// which `partsInStepOrder` records: without them a history would carry alert sources, or a family
// card, that no search in it backs.
async function trustPart(part: ChatPart, state: ConversationState, today: Date): Promise<ChatPart> {
  if (
    part.type === "tool-propose_quote_request" &&
    part.state === "output-available" &&
    part.output.ok
  ) {
    applySend(state);
  }
  if (part.type === "tool-update_trip_brief" && part.state === "output-available") {
    const patch = tripBriefPatchSchema.safeParse(part.input);
    if (!patch.success) {
      return {
        ...part,
        output: toolFailure(
          "validation",
          "Le patch de mise à jour du brief envoyé par le client est invalide et a été ignoré.",
        ),
      };
    }
    return { ...part, output: await recordPatch(state, today, patch.data) };
  }
  if (part.type === "tool-show_destination_card" && part.state === "output-available") {
    return {
      ...part,
      input: destinationCardFields(part.input),
      output: buildDestinationCard(state, part.input),
    };
  }
  return part;
}

// On the first user message, not the last: a note that moves each turn rewrites the middle of
// the history, so the prefix cached at the previous turn no longer matches and cannot be read back.
function withToday(messages: ChatUIMessage[], today: Date): ChatUIMessage[] {
  const index = messages.findIndex((message) => message.role === "user");
  if (index === -1) return messages;
  const note = {
    type: "text" as const,
    text: `[Date du jour : ${today.toISOString().slice(0, 10)}]`,
  };
  return messages.map((message, i) =>
    i === index ? { ...message, parts: [...message.parts, note] } : message,
  );
}

function withCacheBreakpoint(messages: ModelMessage[]): ModelMessage[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const cached: ModelMessage = {
    ...last,
    providerOptions: {
      ...last.providerOptions,
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
  return [...messages.slice(0, -1), cached];
}
