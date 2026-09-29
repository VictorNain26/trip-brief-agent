import { z } from "zod";

const serverEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  TAVILY_API_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}
