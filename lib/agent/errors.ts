import { z } from "zod";

// Two reasons this bound is enforced where the message is built rather than only declared. A
// message interpolates model-supplied values no schema bounds — the invalid-sources list carries
// up to five URLs — and the outputs that hold one are validated again on the next turn, so a
// business failure that overran its own schema would come back as a 400. And a forged failure is
// otherwise a wall of text replayed into the prompt, `search_web`'s and `propose_quote_request`'s
// being replayed as the client sent them.
const MAX_ERROR_MESSAGE_LENGTH = 2000;

export const toolErrorSchema = z.object({
  errorCategory: z.enum(["validation", "transient", "business"]),
  isRetryable: z.boolean(),
  message: z.string().max(MAX_ERROR_MESSAGE_LENGTH),
});

export type ToolErrorCategory = z.infer<typeof toolErrorSchema>["errorCategory"];
export type ToolError = z.infer<typeof toolErrorSchema>;

export function toolFailure(category: ToolErrorCategory, message: string) {
  return {
    ok: false as const,
    error: {
      errorCategory: category,
      isRetryable: category === "transient",
      message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    } satisfies ToolError,
  };
}
