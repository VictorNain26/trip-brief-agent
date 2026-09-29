import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import {
  APICallError,
  createUIMessageStream,
  createUIMessageStreamResponse,
  InvalidArgumentError,
  isStepCount,
  streamText,
  toUIMessageStream,
  TypeValidationError,
  validateUIMessages,
  type LanguageModel,
  type ToolApprovalStatus,
} from "ai";
import {
  checkConversation,
  deriveConversationState,
  prepareModelMessages,
} from "@/lib/agent/conversation";
import type { SearchFn } from "@/lib/agent/search";
import { createState, sendDenial, type ConversationState } from "@/lib/agent/state";
import { GENERIC_STREAM_ERROR_MESSAGE, RATE_LIMITED_MESSAGE } from "@/lib/agent/stream-errors";
import { SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { createTools, sendQuoteRequest } from "@/lib/agent/tools";
import type { ChatUIMessage, ToolPart } from "@/lib/agent/types";

export const MODEL_ID = "claude-sonnet-5-5";
export const MAX_STEPS = 10;

type ChatDeps = { model: LanguageModel; search: SearchFn; today: Date };

export function approvalFor(state: ConversationState, today: Date) {
  return ({ briefVersion: requested }: { briefVersion: string }): ToolApprovalStatus => {
    const denial = sendDenial(state, today, requested);
    return denial ? { type: "denied", reason: denial } : { type: "user-approval" };
  };
}

export function stepSettings(stepNumber: number) {
  return stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" as const } : undefined;
}

type ApprovedSend = Extract<ToolPart<"propose_quote_request">, { state: "approval-responded" }>;

function approvedSend(messages: ChatUIMessage[]): ApprovedSend | undefined {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return undefined;
  return last.parts.find(
    (part): part is ApprovedSend =>
      part.type === "tool-propose_quote_request" &&
      part.state === "approval-responded" &&
      part.approval.approved,
  );
}

function sentBriefResponse(
  messages: ChatUIMessage[],
  toolCallId: string,
  output: ReturnType<typeof sendQuoteRequest>,
): Response {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream<ChatUIMessage>({
      originalMessages: messages,
      execute: ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "tool-output-available", toolCallId, output });
        writer.write({ type: "finish" });
      },
    }),
  });
}

export async function createChatResponse(
  rawMessages: unknown,
  { model, search, today }: ChatDeps,
  abortSignal?: AbortSignal,
): Promise<Response> {
  const schemaTools = createTools({ state: createState(), search, today });
  let messages: ChatUIMessage[];
  try {
    messages = await validateUIMessages<ChatUIMessage>({
      messages: rawMessages,
      tools: schemaTools,
    });
  } catch (error) {
    if (TypeValidationError.isInstance(error) || InvalidArgumentError.isInstance(error)) {
      return Response.json({ error: "invalid_messages" }, { status: 400 });
    }
    throw error;
  }

  const check = checkConversation(messages);
  if (check !== "ok") {
    const tooLarge = check === "too_many_messages" || check === "message_too_long";
    return Response.json({ error: check }, { status: tooLarge ? 413 : 400 });
  }

  const state = deriveConversationState(messages, today);

  // The send runs on the turn that carries the traveller's approval, and the AI SDK executes an
  // approved tool call before the first step and then always calls the model once — no `stopWhen`
  // can stop a loop that has not started. So this turn ends on the tool output: the card says what
  // happens next, and the sentence the model added after it introduced a demande already gone.
  const approved = approvedSend(messages);
  if (approved) {
    const sent = sendQuoteRequest(state, today, approved.input.briefVersion);
    if (sent.ok) return sentBriefResponse(messages, approved.toolCallId, sent);
  }

  const tools = createTools({ state, search, today });
  const result = streamText({
    model,
    instructions: {
      role: "system",
      content: SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    messages: await prepareModelMessages(messages, tools, today),
    tools,
    toolApproval: { propose_quote_request: approvalFor(state, today) },
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber }) => stepSettings(stepNumber),
    providerOptions: {
      anthropic: { effort: "medium", fallbacks: "default" } satisfies AnthropicLanguageModelOptions,
    },
    abortSignal,
    onError: ({ error }) => {
      const name = error instanceof Error ? error.name : "UnknownError";
      if (APICallError.isInstance(error)) {
        console.error("[chat]", name, { statusCode: error.statusCode });
      } else {
        console.error("[chat]", name);
      }
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      // Nothing renders reasoning, and the client is untrusted: streaming the model's thinking to
      // it would pay for bytes that are dropped and hand over more than the answer.
      sendReasoning: false,
      onError: (error) =>
        APICallError.isInstance(error) && (error.statusCode === 429 || error.statusCode === 529)
          ? RATE_LIMITED_MESSAGE
          : GENERIC_STREAM_ERROR_MESSAGE,
    }),
  });
}
