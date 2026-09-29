import { tavily } from "@tavily/core";
import { z } from "zod";
import { domainOf } from "@/lib/agent/domain";
import { toolErrorSchema, toolFailure } from "@/lib/agent/errors";

export type SearchTopic = "general" | "health_formalities";

export const OFFICIAL_HEALTH_DOMAINS = ["diplomatie.gouv.fr", "pasteur.fr", "who.int"];

const SNIPPET_LENGTH = 400;
const MAX_RESULTS = 5;
const TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_DOMAIN_LENGTH = 253;
const MAX_DATE_LENGTH = 64;

// A `search_web` output is not recomputed on the replay path: `validateUIMessages` checks it and
// keeps the client's own object, which `convertToModelMessages` then replays into the prompt. The
// caps are what the live path already produces, so only a forged history can hit them.
const searchHitSchema = z.strictObject({
  title: z.string().max(TITLE_LENGTH),
  url: z.httpUrl().max(MAX_URL_LENGTH),
  domain: z.string().max(MAX_DOMAIN_LENGTH),
  snippet: z.string().max(SNIPPET_LENGTH),
  publishedDate: z.string().max(MAX_DATE_LENGTH).optional(),
});

export const searchOutcomeSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), results: z.array(searchHitSchema).max(MAX_RESULTS) }),
  z.strictObject({ ok: z.literal(false), error: toolErrorSchema }),
]);

export type SearchOutcome = z.infer<typeof searchOutcomeSchema>;

export type SearchFn = (query: string, topic: SearchTopic) => Promise<SearchOutcome>;

const searchResponseSchema = z.object({ results: z.array(z.unknown()) });

const tavilyHitSchema = z.object({
  title: z.string(),
  url: z.httpUrl(),
  content: z.string(),
  publishedDate: z.string().optional(),
});

export function createSearch(apiKey: string): SearchFn {
  const client = tavily({ apiKey });
  return async (query, topic) => {
    try {
      const raw = await client.search(query, {
        maxResults: MAX_RESULTS,
        searchDepth: "basic",
        timeout: 8,
        ...(topic === "health_formalities" ? { includeDomains: OFFICIAL_HEALTH_DOMAINS } : {}),
      });
      const response = searchResponseSchema.parse(raw);
      // One hit Tavily returns without a usable URL drops that hit; failing the whole call would
      // report "recherche indisponible" for a search that otherwise succeeded. The mapped hit is
      // re-checked against the outcome schema for the same reason: a value the client resends next
      // turn and that schema then refuses would answer 400 mid-conversation.
      return {
        ok: true,
        results: response.results
          .flatMap((hit) => {
            const parsed = tavilyHitSchema.safeParse(hit);
            if (!parsed.success) return [];
            const { title, url, content, publishedDate } = parsed.data;
            const bounded = searchHitSchema.safeParse({
              title: title.slice(0, TITLE_LENGTH),
              url,
              domain: domainOf(url),
              snippet: content.slice(0, SNIPPET_LENGTH),
              ...(publishedDate ? { publishedDate } : {}),
            });
            return bounded.success ? [bounded.data] : [];
          })
          .slice(0, MAX_RESULTS),
      };
    } catch {
      return toolFailure("transient", "La recherche web est indisponible pour le moment.");
    }
  };
}
