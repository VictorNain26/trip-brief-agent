import type { InferUITools, UIDataTypes, UIMessage } from "ai";
import type { createTools } from "@/lib/agent/tools";

export type ChatTools = InferUITools<ReturnType<typeof createTools>>;
export type ChatUIMessage = UIMessage<unknown, UIDataTypes, ChatTools>;
export type ChatPart = ChatUIMessage["parts"][number];
export type ToolPart<N extends keyof ChatTools & string> = Extract<ChatPart, { type: `tool-${N}` }>;
