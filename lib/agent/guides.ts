import { readFile } from "node:fs/promises";
import path from "node:path";

export const GUIDE_NAMES = ["family_travel", "responsible_travel"] as const;
export type GuideName = (typeof GUIDE_NAMES)[number];

const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/;

export async function loadGuide(name: GuideName): Promise<string> {
  const file = await readFile(path.join(process.cwd(), "guides", name, "SKILL.md"), "utf8");
  return file.replace(FRONTMATTER, "").trim();
}
