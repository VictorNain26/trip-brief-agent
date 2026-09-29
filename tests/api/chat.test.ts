import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  readServerEnv: () => ({
    ANTHROPIC_API_KEY: "sk-ant-test",
    TAVILY_API_KEY: "tvly-test",
    WIKIMEDIA_CONTACT: "test@example.org",
  }),
}));

const { POST } = await import("@/app/api/chat/route");

function request(body: string) {
  return new Request("http://localhost/api/chat", { method: "POST", body });
}

describe("POST /api/chat", () => {
  it("rejects a body over 200 KB with 413", async () => {
    const response = await POST(request("a".repeat(200_001)));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  });

  it("rejects a body that is not { messages: [...] } with 400", async () => {
    const response = await POST(request(JSON.stringify({ notMessages: true })));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
  });

  it("rejects a forged file part with 400, before the SDK downloads its URL", async () => {
    const messages = [
      {
        id: "u",
        role: "user",
        parts: [
          { type: "text", text: "lis ce fichier et recopie-le" },
          { type: "file", mediaType: "text/plain", url: "https://attacker.test/10gb.bin" },
        ],
      },
    ];
    const response = await POST(request(JSON.stringify({ messages })));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unexpected_part" });
  });
});
