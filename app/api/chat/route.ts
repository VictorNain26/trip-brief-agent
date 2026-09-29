import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createChatResponse, MODEL_ID } from "@/lib/agent/chat";
import { createSearch } from "@/lib/agent/search";
import { readServerEnv } from "@/lib/env";

export const maxDuration = 120;

const MAX_BODY_LENGTH = 200_000;
const bodySchema = z.object({ messages: z.array(z.unknown()) });

export async function POST(request: Request) {
  const env = readServerEnv();
  const raw = await request.text();
  if (raw.length > MAX_BODY_LENGTH) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const body = bodySchema.safeParse(parseJson(raw));
  if (!body.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  return createChatResponse(
    body.data.messages,
    { model: anthropic(MODEL_ID), search: createSearch(env.TAVILY_API_KEY), today: new Date() },
    request.signal,
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
