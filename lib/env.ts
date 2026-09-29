import { z } from "zod";

const serverEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  TAVILY_API_KEY: z.string().min(1),
  // Wikimedia asks API clients for contact details in their User-Agent (a URL or an email).
  WIKIMEDIA_CONTACT: z.string().min(1).default("https://github.com/VictorNain26/trip-brief-agent"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

// Format from https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
export function wikimediaUserAgent(contact: string): string {
  return `trip-brief-agent/0.1 (${contact})`;
}
