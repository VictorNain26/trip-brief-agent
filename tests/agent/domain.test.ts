import { describe, expect, it } from "vitest";
import { domainOf } from "@/lib/agent/domain";

describe("domainOf", () => {
  it("keeps the host of a valid URL, path and port aside", () => {
    expect(domainOf("https://diplomatie.gouv.fr/fr/conseils/vietnam?a=1")).toBe(
      "diplomatie.gouv.fr",
    );
    expect(domainOf("https://example.org:8443/voyage")).toBe("example.org");
  });

  it("strips a leading www. so two spellings of one publisher read alike", () => {
    expect(domainOf("https://www.example.org/vietnam/")).toBe("example.org");
  });

  it("returns a malformed string unchanged instead of throwing", () => {
    expect(domainOf("pas une url")).toBe("pas une url");
    expect(domainOf("")).toBe("");
  });
});
