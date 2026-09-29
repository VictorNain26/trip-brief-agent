import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();
vi.mock("@tavily/core", () => ({ tavily: () => ({ search }) }));

const { createSearch, OFFICIAL_HEALTH_DOMAINS, searchOutcomeSchema } =
  await import("@/lib/agent/search");

const result = (overrides: Record<string, unknown> = {}) => ({
  title: "Saison des pluies au Vietnam",
  url: "https://www.example.org/vietnam-climat",
  content: "x".repeat(600),
  score: 0.9,
  publishedDate: "",
  id: "1",
  ...overrides,
});

describe("createSearch", () => {
  // Sync beforeEach + a rejected mock awaited-and-caught in the test body makes Vitest 5.0.1
  // misreport it as an unhandled rejection; the extra tick from an async hook avoids that.
  beforeEach(async () => {
    search.mockReset();
  });

  it("maps results, trims snippets and extracts the domain", async () => {
    search.mockResolvedValue({ results: [result()] });
    const outcome = await createSearch("key")("climat Vietnam novembre", "general");
    expect(outcome).toEqual({
      ok: true,
      results: [
        {
          title: "Saison des pluies au Vietnam",
          url: "https://www.example.org/vietnam-climat",
          domain: "example.org",
          snippet: "x".repeat(400),
        },
      ],
    });
  });

  it("restricts health questions to official domains", async () => {
    search.mockResolvedValue({ results: [] });
    await createSearch("key")("paludisme Tanzanie enfant", "health_formalities");
    expect(search).toHaveBeenCalledWith(
      "paludisme Tanzanie enfant",
      expect.objectContaining({
        maxResults: 5,
        timeout: 8,
        includeDomains: OFFICIAL_HEALTH_DOMAINS,
      }),
    );
  });

  it("does not restrict domains for general questions", async () => {
    search.mockResolvedValue({ results: [] });
    await createSearch("key")("kitesurf avril", "general");
    expect(search.mock.calls[0][1]).not.toHaveProperty("includeDomains");
  });

  it("returns an empty list as a success", async () => {
    search.mockResolvedValue({ results: [] });
    expect(await createSearch("key")("rien", "general")).toEqual({ ok: true, results: [] });
  });

  it("turns SDK errors into a transient tool error", async () => {
    search.mockRejectedValue(new Error("Request timed out after 8 seconds."));
    const outcome = await createSearch("key")("Népal juillet", "general");
    expect(outcome).toEqual({
      ok: false,
      error: {
        errorCategory: "transient",
        isRetryable: true,
        message: "La recherche web est indisponible pour le moment.",
      },
    });
  });

  it("keeps a valid publishedDate and drops an empty one", async () => {
    search.mockResolvedValue({ results: [result({ publishedDate: "2026-01-05" })] });
    const outcome = await createSearch("key")("q", "general");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.results[0]?.publishedDate).toBe("2026-01-05");
  });

  it("drops a hit with a malformed URL and keeps the valid ones", async () => {
    search.mockResolvedValue({
      results: [result({ url: "not-a-url" }), result({ url: "https://example.org/ok" })],
    });
    const outcome = await createSearch("key")("q", "general");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.results.map((r) => r.url)).toEqual(["https://example.org/ok"]);
  });

  it("drops a hit whose URL is not http(s), which the UI would render as an href", async () => {
    search.mockResolvedValue({
      results: [
        result({ url: "javascript:alert(1)" }),
        result({ url: "data:text/html,<script>alert(1)</script>" }),
        result({ url: "https://example.org/ok" }),
      ],
    });
    const outcome = await createSearch("key")("q", "general");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.results.map((r) => r.url)).toEqual(["https://example.org/ok"]);
  });

  it("still returns five hits when a malformed one sits beyond the cap", async () => {
    search.mockResolvedValue({
      results: [
        ...Array.from({ length: 5 }, (_, i) => result({ url: `https://example.org/${i}` })),
        result({ url: "not-a-url" }),
      ],
    });
    const outcome = await createSearch("key")("q", "general");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.results.map((r) => r.url)).toEqual([
      "https://example.org/0",
      "https://example.org/1",
      "https://example.org/2",
      "https://example.org/3",
      "https://example.org/4",
    ]);
  });

  it("caps mapped results at 5 even when the SDK returns more", async () => {
    search.mockResolvedValue({
      results: Array.from({ length: 7 }, (_, i) => result({ url: `https://example.org/${i}` })),
    });
    const outcome = await createSearch("key")("q", "general");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.results).toHaveLength(5);
  });

  it("reports no source found when every hit is malformed", async () => {
    search.mockResolvedValue({ results: [{ title: "no url here", content: "some content" }] });
    expect(await createSearch("key")("q", "general")).toEqual({ ok: true, results: [] });
  });

  it("keeps what it maps within the outcome schema the next turn is validated against", async () => {
    search.mockResolvedValue({
      results: [
        result({ title: "t".repeat(5000), content: "c".repeat(5000) }),
        result({ url: `https://example.org/${"p".repeat(3000)}`, title: "dropped" }),
        result({ url: "https://example.org/ok", publishedDate: "d".repeat(500) }),
      ],
    });
    const outcome = await createSearch("key")("q", "general");
    expect(searchOutcomeSchema.safeParse(outcome).success).toBe(true);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.results.map((r) => r.url)).toEqual(["https://www.example.org/vietnam-climat"]);
    expect(outcome.results[0]?.title).toHaveLength(200);
  });

  it("turns a response missing the results array into a transient tool error", async () => {
    search.mockResolvedValue({});
    const outcome = await createSearch("key")("q", "general");
    expect(outcome).toEqual({
      ok: false,
      error: {
        errorCategory: "transient",
        isRetryable: true,
        message: "La recherche web est indisponible pour le moment.",
      },
    });
  });
});
