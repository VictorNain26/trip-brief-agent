import { describe, expect, it } from "vitest";
import { loadFamilyGuide } from "@/lib/agent/guides";

describe("loadFamilyGuide", () => {
  it("returns the family guide body without frontmatter", async () => {
    const body = await loadFamilyGuide();
    expect(body.startsWith("## Ton")).toBe(true);
    expect(body).toContain("L'âge de chaque enfant");
    expect(body).not.toContain("description:");
  });
});
