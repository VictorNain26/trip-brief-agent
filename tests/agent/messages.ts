import type { ChatUIMessage } from "@/lib/agent/types";

export const user = (id: string, text: string): ChatUIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

export const assistant = (id: string, parts: ChatUIMessage["parts"]): ChatUIMessage => ({
  id,
  role: "assistant",
  parts,
});
