import { describe, expect, it } from "vitest";
import { DESTINATION_IDS, destinationLabel } from "@/lib/catalogue";

describe("catalogue", () => {
  it("labels ISO 3166-1 destinations in French and falls back to the id for an unknown one", () => {
    expect(destinationLabel("VN")).toBe("Viêt Nam");
    expect(destinationLabel("CI")).toBe("Côte d’Ivoire");
    expect(destinationLabel("atlantide")).toBe("atlantide");
  });

  it("has unique two-letter ids and none of CLDR's groupings", () => {
    expect(new Set(DESTINATION_IDS).size).toBe(DESTINATION_IDS.length);
    expect(DESTINATION_IDS.every((id) => /^[A-Z]{2}$/.test(id))).toBe(true);
    expect(DESTINATION_IDS).not.toContain("EU");
    expect(DESTINATION_IDS).not.toContain("ZZ");
  });
});
