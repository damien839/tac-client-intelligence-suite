import { promises as fs } from "fs";
import path from "path";

/**
 * Reads the Final Mile Analyzer skill from disk.
 * Skill source of truth lives at /skills/final-mile-analyzer/.
 *
 * In production (Vercel), the skill folder is bundled with the Next.js
 * deployment because it sits inside the project root.
 */

const SKILL_DIR = path.join(process.cwd(), "skills", "final-mile-analyzer");

export interface AnalyzerSkill {
  /** Frontmatter block from SKILL.md */
  frontmatter: SkillFrontmatter;
  /** Body of SKILL.md (post-frontmatter) */
  skillBody: string;
  /** Concatenated reference content (data-model, metrics, structure, sanity-checks) */
  referencesBundle: string;
  /** Chat-mode system prompt (post-frontmatter body) */
  chatPrompt: string;
  /** Report-mode system prompt (post-frontmatter body) */
  reportPrompt: string;
  /** Report payload JSON schema as a parsed object */
  reportSchema: Record<string, unknown>;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  brand?: string;
  runtime: {
    chat_model: string;
    report_model: string;
    max_tokens_chat: number;
    max_tokens_report: number;
    temperature_chat: number;
    temperature_report: number;
  };
}

let cached: { skill: AnalyzerSkill; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30s — enough to survive a render burst, fresh enough that edits show up fast

export async function loadAnalyzerSkill(force = false): Promise<AnalyzerSkill> {
  if (!force && cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.skill;
  }

  const [skillRaw, dataModel, metrics, structure, sanity, chatRaw, reportRaw, schemaRaw] =
    await Promise.all([
      fs.readFile(path.join(SKILL_DIR, "SKILL.md"), "utf8"),
      fs.readFile(path.join(SKILL_DIR, "references", "data-model.md"), "utf8"),
      fs.readFile(path.join(SKILL_DIR, "references", "metrics.md"), "utf8"),
      fs.readFile(path.join(SKILL_DIR, "references", "report-structure.md"), "utf8"),
      fs.readFile(path.join(SKILL_DIR, "references", "sanity-checks.md"), "utf8"),
      fs.readFile(path.join(SKILL_DIR, "prompts", "chat-mode.md"), "utf8"),
      fs.readFile(path.join(SKILL_DIR, "prompts", "report-mode.md"), "utf8"),
      fs.readFile(path.join(SKILL_DIR, "schemas", "report.schema.json"), "utf8"),
    ]);

  const { frontmatter, body } = parseFrontmatter(skillRaw);

  const skill: AnalyzerSkill = {
    frontmatter,
    skillBody: body,
    referencesBundle: [
      "## references/data-model.md\n\n" + dataModel,
      "## references/metrics.md\n\n" + metrics,
      "## references/report-structure.md\n\n" + structure,
      "## references/sanity-checks.md\n\n" + sanity,
    ].join("\n\n---\n\n"),
    chatPrompt: stripFrontmatter(chatRaw),
    reportPrompt: stripFrontmatter(reportRaw),
    reportSchema: JSON.parse(schemaRaw),
  };

  cached = { skill, loadedAt: Date.now() };
  return skill;
}

function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("SKILL.md is missing frontmatter block");
  }
  const yamlBlock = match[1];
  const body = match[2];

  const frontmatter = parseSimpleYaml(yamlBlock) as unknown as SkillFrontmatter;
  if (!frontmatter.name || !frontmatter.runtime) {
    throw new Error("SKILL.md frontmatter missing required keys (name, runtime)");
  }
  return { frontmatter, body };
}

function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : raw;
}

/**
 * Minimal YAML parser for the frontmatter shape we control.
 * Supports: top-level scalars and a single-level nested object.
 * Values are strings unless they parse cleanly as numbers.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const lines = yaml.split("\n");
  const root: Record<string, unknown> = {};
  let currentNested: { key: string; value: Record<string, unknown> } | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const indentMatch = rawLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const line = rawLine.trim();

    if (indent === 0) {
      // top-level key
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const valueRaw = line.slice(colonIdx + 1).trim();

      if (valueRaw === "") {
        currentNested = { key, value: {} };
        root[key] = currentNested.value;
      } else {
        currentNested = null;
        root[key] = coerce(valueRaw);
      }
    } else if (currentNested) {
      // nested under previous key
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const valueRaw = line.slice(colonIdx + 1).trim();
      currentNested.value[key] = coerce(valueRaw);
    }
  }

  return root;
}

function coerce(raw: string): string | number {
  const stripped = raw.replace(/^["']|["']$/g, "");
  if (/^-?\d+(\.\d+)?$/.test(stripped)) return Number(stripped);
  return stripped;
}
