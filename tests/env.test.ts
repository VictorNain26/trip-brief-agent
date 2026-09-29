import { describe, expect, it } from "vitest";
import { readServerEnv } from "@/lib/env";

const valid = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  TAVILY_API_KEY: "tvly-test",
};

describe("readServerEnv", () => {
  it("returns the validated variables", () => {
    expect(readServerEnv(valid)).toEqual(valid);
  });

  it("throws when a key is missing", () => {
    expect(() => readServerEnv({ ...valid, TAVILY_API_KEY: undefined })).toThrow();
  });
});
