import { readFile } from "node:fs/promises";
import path from "node:path";

const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/;

export async function loadFamilyGuide(): Promise<string> {
  const file = await readFile(
    path.join(process.cwd(), "guides", "family_travel", "SKILL.md"),
    "utf8",
  );
  return file.replace(FRONTMATTER, "").trim();
}
