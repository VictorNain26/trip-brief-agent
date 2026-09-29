import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { readUIMessageStream, wrapLanguageModel, type UIMessageChunk } from "ai";
import { createChatResponse, MODEL_ID } from "@/lib/agent/chat";
import { createPhotoSearch } from "@/lib/agent/photos";
import { createSearch, type SearchFn } from "@/lib/agent/search";
import type { ChatUIMessage } from "@/lib/agent/types";
import { readServerEnv, wikimediaUserAgent } from "@/lib/env";
import {
  answerPendingQuestions,
  pendingApproval,
  shouldSendAutomatically,
} from "@/lib/chat/client-state";
import { chunks } from "../agent/stream";

export type TravellerTurn = { say: string } | { approve: boolean; reason?: "modifier" | "abandon" };

type CallUsage = {
  noCache: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** Thinking text the model returned: the route never sends it to the browser. */
  reasoning: string;
};

export type Run = {
  messages: ChatUIMessage[];
  /** The conversation as it stood after each traveller turn and the requests it triggered. */
  afterTurn: ChatUIMessage[][];
  errors: string[];
  /** What the scripted traveller could not do, such as approving a recap that never came. */
  notes: string[];
  calls: CallUsage[];
  ms: number;
};

type Part = ChatUIMessage["parts"][number];

// The client re-posts on its own after tool outputs or an approval (`shouldSendAutomatically`);
// this caps how many times one traveller turn can do so.
const MAX_REQUESTS_PER_TURN = 6;

// Claude Sonnet 5.5, per million tokens: $2 input, $2.50 5-minute cache write, $0.20 cache read,
// $10 output (https://platform.claude.com/docs/en/about-claude/models/migration-guide).
const PRICE = { noCache: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };

export const REPORT_PATH = path.join(process.cwd(), ".eval", "report.md");

export const hasKeys = Boolean(process.env.ANTHROPIC_API_KEY && process.env.TAVILY_API_KEY);

function recordingModel(calls: CallUsage[]) {
  return wrapLanguageModel({
    model: anthropic(MODEL_ID),
    middleware: {
      wrapStream: async ({ doStream }) => {
        const { stream, ...rest } = await doStream();
        let reasoning = "";
        const recorder = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === "reasoning-delta") reasoning += part.delta;
            if (part.type === "finish") {
              calls.push({
                noCache: part.usage.inputTokens.noCache ?? 0,
                cacheRead: part.usage.inputTokens.cacheRead ?? 0,
                cacheWrite: part.usage.inputTokens.cacheWrite ?? 0,
                output: part.usage.outputTokens.total ?? 0,
                reasoning,
              });
            }
            controller.enqueue(part);
          },
        });
        return { ...rest, stream: stream.pipeThrough(recorder) };
      },
    },
  });
}

function replaceInLast(messages: ChatUIMessage[], update: (part: Part) => Part): ChatUIMessage[] {
  const last = messages.at(-1);
  if (!last) return messages;
  return [...messages.slice(0, -1), { ...last, parts: last.parts.map(update) }];
}

// What the browser does with a traveller's action: an approval answers the recap, and text answers
// a pending choice question if there is one (chat.tsx `submitText`) or becomes a new message.
// Returns undefined when the action has nothing to act on, which ends the conversation there.
function applyTurn(messages: ChatUIMessage[], turn: TravellerTurn): ChatUIMessage[] | undefined {
  if ("approve" in turn) {
    const pending = pendingApproval(messages);
    if (!pending) return undefined;
    return replaceInLast(messages, (part) =>
      "toolCallId" in part && part.toolCallId === pending.toolCallId
        ? ({
            ...part,
            state: "approval-responded",
            approval: { id: pending.approval.id, approved: turn.approve, reason: turn.reason },
          } as Part)
        : part,
    );
  }
  const answers = answerPendingQuestions(messages, { freeText: turn.say });
  if (answers.length > 0) {
    return replaceInLast(messages, (part) => {
      const answer = answers.find((a) => "toolCallId" in part && a.toolCallId === part.toolCallId);
      if (!answer) return part;
      return (
        "output" in answer
          ? { ...part, state: "output-available", output: answer.output }
          : { ...part, state: "output-error", errorText: answer.errorText }
      ) as Part;
    });
  }
  const id = `u${messages.length}`;
  return [
    ...messages,
    { id, role: "user" as const, parts: [{ type: "text" as const, text: turn.say }] },
  ];
}

function streamOf(parsed: Record<string, unknown>[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of parsed) controller.enqueue(chunk as UIMessageChunk);
      controller.close();
    },
  });
}

export async function converse(
  turns: TravellerTurn[],
  options: { search?: (base: SearchFn) => SearchFn } = {},
): Promise<Run> {
  const calls: CallUsage[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const afterTurn: ChatUIMessage[][] = [];
  const base = createSearch(process.env.TAVILY_API_KEY ?? "");
  const deps = {
    model: recordingModel(calls),
    search: options.search ? options.search(base) : base,
    photos: createPhotoSearch(wikimediaUserAgent(readServerEnv().WIKIMEDIA_CONTACT)),
    today: new Date(),
  };
  const started = Date.now();
  let messages: ChatUIMessage[] = [];

  for (const turn of turns) {
    const next = applyTurn(messages, turn);
    if (!next) {
      notes.push("the recap to answer never came; conversation stopped");
      break;
    }
    messages = next;
    for (let request = 0; request < MAX_REQUESTS_PER_TURN; request += 1) {
      const response = await createChatResponse(messages, deps);
      const body = await response.text();
      if (!response.ok) {
        errors.push(`HTTP ${response.status}: ${body}`);
        break;
      }
      const parsed = chunks(body);
      for (const chunk of parsed) {
        if (chunk.type === "error") errors.push(String(chunk.errorText));
      }
      const last = messages.at(-1);
      const continuing = last?.role === "assistant" ? last : undefined;
      let message: ChatUIMessage | undefined;
      for await (const snapshot of readUIMessageStream<ChatUIMessage>({
        message: continuing,
        stream: streamOf(parsed),
        onError: (error) => errors.push(String(error)),
      })) {
        message = snapshot;
      }
      if (message)
        messages = continuing ? [...messages.slice(0, -1), message] : [...messages, message];
      if (!shouldSendAutomatically({ messages })) break;
    }
    afterTurn.push(messages);
  }
  return { messages, afterTurn, errors, notes, calls, ms: Date.now() - started };
}

export function toolParts(messages: ChatUIMessage[], tool: string) {
  return messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === `tool-${tool}`);
}

// What the traveller reads from the agent: its text parts and the intro above each question.
export function assistantTexts(messages: ChatUIMessage[]): string[] {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "tool-ask_traveler" && part.input?.intro) return [part.input.intro];
      return [];
    });
}

export function cost(calls: CallUsage[]): number {
  const total = calls.reduce(
    (sum, call) =>
      sum +
      call.noCache * PRICE.noCache +
      call.cacheWrite * PRICE.cacheWrite +
      call.cacheRead * PRICE.cacheRead +
      call.output * PRICE.output,
    0,
  );
  return total / 1_000_000;
}

function describePart(part: Part): string | undefined {
  if (part.type === "text") return `  « ${part.text.replace(/\s+/g, " ").slice(0, 220)} »`;
  if (part.type === "tool-ask_traveler" && part.input?.intro) {
    const intro = `  intro « ${part.input.intro.replace(/\s+/g, " ").slice(0, 300)} »`;
    return `${intro}\n  [ask_traveler] ${part.state} ${part.input.question}`;
  }
  if (!part.type.startsWith("tool-")) return undefined;
  const tool = part as { type: string; state: string; input?: unknown; output?: unknown };
  const input = JSON.stringify(tool.input ?? {}).slice(0, 180);
  const ok =
    tool.output && typeof tool.output === "object" && "ok" in tool.output
      ? ` → ok=${String((tool.output as { ok: unknown }).ok)}`
      : "";
  return `  [${tool.type.slice(5)}] ${tool.state} ${input}${ok}`;
}

export function report(name: string, run: Run): void {
  const lines = [`\n=== ${name} ===`];
  for (const message of run.messages) {
    if (message.role === "user") {
      const text = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ");
      lines.push(`Voyageur : ${text}`);
      continue;
    }
    for (const part of message.parts) {
      const line = describePart(part);
      if (line) lines.push(line);
    }
  }
  const tokens = run.calls.reduce(
    (sum, c) => ({
      input: sum.input + c.noCache + c.cacheRead + c.cacheWrite,
      cached: sum.cached + c.cacheRead,
      output: sum.output + c.output,
    }),
    { input: 0, cached: 0, output: 0 },
  );
  lines.push(
    `model calls ${run.calls.length} · input ${tokens.input} (cache read ${tokens.cached}) · output ${tokens.output} · $${cost(run.calls).toFixed(3)} · ${(run.ms / 1000).toFixed(1)} s`,
  );
  if (run.errors.length > 0) lines.push(`errors: ${run.errors.join(" | ")}`);
  if (run.notes.length > 0) lines.push(`notes: ${run.notes.join(" | ")}`);
  run.calls.forEach((call, index) => {
    const text = call.reasoning.replace(/\s+/g, " ").trim();
    if (text) lines.push(`  thinking ${index + 1}: ${text.slice(0, 300)}`);
  });
  // A file rather than the console: the reporter drops the console output of passing tests.
  appendFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
}

export function startReport(): void {
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `# Live evaluation — ${MODEL_ID} — ${new Date().toISOString()}\n`);
}
