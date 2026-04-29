/**
 * Parser for `SKILLS.md` files.
 *
 * A `SKILLS.md` file is a simple Markdown document where each `##`-level
 * heading names a skill and the paragraphs beneath describe it. We use a
 * line-based scanner — matching the Rust implementation exactly — to keep
 * both parsers auditable.
 */

import { readFile } from "node:fs/promises";

import { InvalidSkillsMarkdownError } from "./errors.js";

export interface SkillEntry {
  readonly name: string;
  readonly description: string;
}

export class SkillsManifest {
  readonly skills: readonly SkillEntry[];

  private constructor(skills: SkillEntry[]) {
    this.skills = Object.freeze(skills);
  }

  /**
   * Parse a SKILLS.md document from an in-memory string.
   *
   * @throws InvalidSkillsMarkdownError if the document contains zero `##`
   *   headings or a duplicate skill name.
   */
  static fromMarkdown(input: string): SkillsManifest {
    const skills: SkillEntry[] = [];
    let currentName: string | null = null;
    let currentLines: string[] = [];

    const flush = (): void => {
      if (currentName !== null) {
        skills.push({
          name: currentName,
          description: joinDescription(currentLines),
        });
      }
      currentName = null;
      currentLines = [];
    };

    const lines = input.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      const heading = parseSkillHeading(line);
      if (heading !== null) {
        flush();
        currentName = heading;
        continue;
      }
      if (line.startsWith("# ")) {
        // Skip top-level H1s.
        continue;
      }
      if (currentName !== null) {
        currentLines.push(line);
      }
    }
    flush();

    if (skills.length === 0) {
      throw new InvalidSkillsMarkdownError(
        "no `## <skill>` headings found",
      );
    }

    const seen = new Set<string>();
    for (const s of skills) {
      if (seen.has(s.name)) {
        throw new InvalidSkillsMarkdownError(
          `duplicate skill \`${s.name}\``,
        );
      }
      seen.add(s.name);
    }

    return new SkillsManifest(skills);
  }

  /**
   * Load and parse a SKILLS.md file from the local filesystem.
   */
  static async fromFile(path: string): Promise<SkillsManifest> {
    const content = await readFile(path, "utf8");
    return SkillsManifest.fromMarkdown(content);
  }

  get length(): number {
    return this.skills.length;
  }

  get isEmpty(): boolean {
    return this.skills.length === 0;
  }

  get(name: string): SkillEntry | undefined {
    return this.skills.find((s) => s.name === name);
  }

  names(): string[] {
    return this.skills.map((s) => s.name);
  }
}

function parseSkillHeading(line: string): string | null {
  if (!line.startsWith("##")) return null;
  const rest = line.slice(2);
  if (rest.startsWith("#")) return null; // H3 or deeper
  const name = rest.trim();
  if (name.length === 0) return null;
  return name;
}

function joinDescription(lines: string[]): string {
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i];
    if (entry !== undefined && entry.trim().length > 0) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1 || last === -1) return "";
  return lines.slice(first, last + 1).join("\n");
}
