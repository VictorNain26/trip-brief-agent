import { describe, expect, it } from "vitest";
import { readServerEnv, wikimediaUserAgent } from "@/lib/env";

const valid = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  TAVILY_API_KEY: "tvly-test",
  WIKIMEDIA_CONTACT: "ops@example.org",
};

describe("readServerEnv", () => {
  it("returns the validated variables", () => {
    expect(readServerEnv(valid)).toEqual(valid);
  });

  it("throws when a key is missing", () => {
    expect(() => readServerEnv({ ...valid, TAVILY_API_KEY: undefined })).toThrow();
  });

  // Fails if the Wikimedia contact becomes required: the app would stop starting for anyone who
  // only set the two API keys the README asks for.
  it("falls back to the repository as the Wikimedia contact", () => {
    const keys = {
      ANTHROPIC_API_KEY: valid.ANTHROPIC_API_KEY,
      TAVILY_API_KEY: valid.TAVILY_API_KEY,
    };
    expect(readServerEnv(keys).WIKIMEDIA_CONTACT).toMatch(/^https:\/\//);
  });
});

describe("wikimediaUserAgent", () => {
  // Wikimedia may block clients without contact details in their User-Agent.
  it("names the client and carries the contact", () => {
    expect(wikimediaUserAgent("ops@example.org")).toBe("trip-brief-agent/0.1 (ops@example.org)");
  });
});
