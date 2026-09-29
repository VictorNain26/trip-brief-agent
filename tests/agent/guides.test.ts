import { describe, expect, it } from "vitest";
import { loadGuide } from "@/lib/agent/guides";

describe("loadGuide", () => {
  it("returns the family guide body without frontmatter", async () => {
    const body = await loadGuide("family_travel");
    expect(body.startsWith("## Ton")).toBe(true);
    expect(body).toContain("L'âge de chaque enfant");
    expect(body).not.toContain("description:");
  });

  it("returns the responsible travel guide", async () => {
    const body = await loadGuide("responsible_travel");
    expect(body).toContain("Partir hors saison");
  });
});
