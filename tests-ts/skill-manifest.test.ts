/**
 * Tests for the new skill manifest files introduced in this PR:
 *
 * - skills/autoresearch/SKILL.md  (new Agent Skill entrypoint)
 * - skills/autoresearch/agents/openai.yaml  (new ChatGPT/OpenAI UI metadata)
 *
 * These tests validate that the files exist at the expected paths, that the
 * required structural fields are present and non-empty, and that the content
 * matches the documented contract (correct commands, tools, hooks, etc.).
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readText(relPath: string): string {
  return readFileSync(join(root, relPath), "utf-8");
}

/**
 * Minimal YAML front-matter parser. Extracts key: value pairs from the
 * opening --- ... --- block. Values are returned as trimmed strings.
 */
function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Very small YAML parser for simple flat or single-nested objects.
 * Sufficient for the two-level openai.yaml structure used in this repo.
 */
function parseSimpleYaml(yaml: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection: string | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw;
    if (!line.trim()) continue;
    const topMatch = line.match(/^(\w[\w-]*):\s*$/);
    if (topMatch) {
      currentSection = topMatch[1];
      result[currentSection] = {};
      continue;
    }
    const nestedMatch = line.match(/^\s{2,}(\w[\w_-]*):\s*(.+)$/);
    if (nestedMatch && currentSection) {
      let value = nestedMatch[2].trim();
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[currentSection][nestedMatch[1]] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// skills/autoresearch/SKILL.md — file existence
// ---------------------------------------------------------------------------

test("skills/autoresearch/SKILL.md exists at the expected path", () => {
  assert.ok(
    existsSync(join(root, "skills/autoresearch/SKILL.md")),
    "skills/autoresearch/SKILL.md must exist",
  );
});

// ---------------------------------------------------------------------------
// skills/autoresearch/SKILL.md — YAML frontmatter
// ---------------------------------------------------------------------------

test("SKILL.md has a YAML frontmatter block", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  assert.ok(
    content.startsWith("---"),
    "SKILL.md must start with a YAML frontmatter block (---)",
  );
  assert.ok(
    /^---\r?\n[\s\S]*?\r?\n---/m.test(content),
    "SKILL.md must have a closing --- to end the frontmatter block",
  );
});

test("SKILL.md frontmatter has a non-empty name field", () => {
  const fm = parseFrontmatter(readText("skills/autoresearch/SKILL.md"));
  assert.ok(typeof fm["name"] === "string" && fm["name"].length > 0, "frontmatter 'name' must be a non-empty string");
});

test("SKILL.md frontmatter name matches the package name", () => {
  const fm = parseFrontmatter(readText("skills/autoresearch/SKILL.md"));
  assert.equal(fm["name"], "pi-autoresearch");
});

test("SKILL.md frontmatter has a non-empty description field", () => {
  const fm = parseFrontmatter(readText("skills/autoresearch/SKILL.md"));
  assert.ok(
    typeof fm["description"] === "string" && fm["description"].length > 20,
    "frontmatter 'description' must be a meaningful non-empty string",
  );
});

test("SKILL.md frontmatter description mentions autoresearch workflows", () => {
  const fm = parseFrontmatter(readText("skills/autoresearch/SKILL.md"));
  assert.ok(
    fm["description"].toLowerCase().includes("autoresearch"),
    "description should reference autoresearch",
  );
});

// ---------------------------------------------------------------------------
// skills/autoresearch/SKILL.md — body content contract
// ---------------------------------------------------------------------------

test("SKILL.md documents the Pi Extension commands", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  const commands = ["/autoresearch status", "/autoresearch start", "/autoresearch ralph", "/autoresearch pause"];
  for (const cmd of commands) {
    assert.ok(content.includes(cmd), `SKILL.md must mention command: ${cmd}`);
  }
});

test("SKILL.md documents the four LLM-callable tools", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  const tools = [
    "autoresearch_state",
    "autoresearch_metric",
    "autoresearch_decide",
    "autoresearch_dashboard",
  ];
  for (const tool of tools) {
    assert.ok(content.includes(tool), `SKILL.md must reference tool: ${tool}`);
  }
});

test("SKILL.md documents the lifecycle hooks", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  const hooks = ["before_agent_start", "tool_call", "agent_end", "session_before_compact"];
  for (const hook of hooks) {
    assert.ok(content.includes(hook), `SKILL.md must mention lifecycle hook: ${hook}`);
  }
});

test("SKILL.md describes both Assisted and Ralph modes", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  assert.ok(content.includes("Assisted"), "SKILL.md must describe Assisted mode");
  assert.ok(content.includes("Ralph"), "SKILL.md must describe Ralph (Wiggum) mode");
});

test("SKILL.md includes a stop-conditions section", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  assert.ok(content.includes("Stop Conditions") || content.includes("stop condition"), "SKILL.md must have a Stop Conditions section");
});

test("SKILL.md mentions the consecutive-discard limit (5)", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  assert.ok(
    /5 consecutive discard/i.test(content),
    "SKILL.md must state the consecutive-discard stop threshold of 5",
  );
});

test("SKILL.md mentions the plateau limit (10 runs)", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  assert.ok(
    /10 runs without improvement/i.test(content),
    "SKILL.md must state the plateau stop threshold of 10 runs",
  );
});

test("SKILL.md references the required protocol documents", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  const refs = [
    "state-protocol.md",
    "benchmark-policy.md",
    "safety-policy.md",
  ];
  for (const ref of refs) {
    assert.ok(content.includes(ref), `SKILL.md must reference protocol file: ${ref}`);
  }
});

test("SKILL.md lists the default runtime artifacts", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  const artifacts = [
    "autoresearch.md",
    "autoresearch.jsonl",
    "AUTORESEARCH_STATE.json",
    "autoresearch-dashboard.md",
    ".autoresearch-off",
  ];
  for (const artifact of artifacts) {
    assert.ok(content.includes(artifact), `SKILL.md must list runtime artifact: ${artifact}`);
  }
});

test("SKILL.md decision rules state correctness beats performance", () => {
  const content = readText("skills/autoresearch/SKILL.md");
  assert.ok(
    /correctness beats performance/i.test(content),
    "SKILL.md must state that correctness takes priority over performance",
  );
});

// ---------------------------------------------------------------------------
// skills/autoresearch/agents/openai.yaml — file existence
// ---------------------------------------------------------------------------

test("skills/autoresearch/agents/openai.yaml exists at the expected path", () => {
  assert.ok(
    existsSync(join(root, "skills/autoresearch/agents/openai.yaml")),
    "skills/autoresearch/agents/openai.yaml must exist",
  );
});

// ---------------------------------------------------------------------------
// skills/autoresearch/agents/openai.yaml — required fields
// ---------------------------------------------------------------------------

test("openai.yaml has an interface section", () => {
  const yaml = readText("skills/autoresearch/agents/openai.yaml");
  assert.ok(yaml.includes("interface:"), "openai.yaml must have an 'interface:' section");
});

test("openai.yaml interface.display_name is 'Autoresearch'", () => {
  const parsed = parseSimpleYaml(readText("skills/autoresearch/agents/openai.yaml"));
  assert.ok(parsed["interface"], "interface section must be present");
  assert.equal(
    parsed["interface"]["display_name"],
    "Autoresearch",
    "interface.display_name must be 'Autoresearch'",
  );
});

test("openai.yaml interface.short_description is non-empty", () => {
  const parsed = parseSimpleYaml(readText("skills/autoresearch/agents/openai.yaml"));
  const desc = parsed["interface"]?.["short_description"] ?? "";
  assert.ok(desc.length > 0, "interface.short_description must not be empty");
});

test("openai.yaml interface.short_description mentions optimization", () => {
  const yaml = readText("skills/autoresearch/agents/openai.yaml");
  assert.ok(
    /optim/i.test(yaml),
    "short_description should mention optimization to describe the skill purpose",
  );
});

test("openai.yaml interface.icon is defined and non-empty", () => {
  const parsed = parseSimpleYaml(readText("skills/autoresearch/agents/openai.yaml"));
  const icon = parsed["interface"]?.["icon"] ?? "";
  assert.ok(icon.length > 0, "interface.icon must not be empty");
});

test("openai.yaml interface.icon is 'microscope'", () => {
  const parsed = parseSimpleYaml(readText("skills/autoresearch/agents/openai.yaml"));
  assert.equal(parsed["interface"]?.["icon"], "microscope");
});

test("openai.yaml interface.brand_color is defined and non-empty", () => {
  const yaml = readText("skills/autoresearch/agents/openai.yaml");
  assert.ok(
    /brand_color\s*:/.test(yaml),
    "openai.yaml must have a brand_color field",
  );
});

test("openai.yaml interface.brand_color is a valid CSS hex colour", () => {
  const parsed = parseSimpleYaml(readText("skills/autoresearch/agents/openai.yaml"));
  const color = parsed["interface"]?.["brand_color"] ?? "";
  assert.ok(
    /^#[0-9a-fA-F]{3,8}$/.test(color),
    `brand_color must be a valid CSS hex colour, got: "${color}"`,
  );
});

// ---------------------------------------------------------------------------
// Cross-file consistency checks
// ---------------------------------------------------------------------------

test("SKILL.md name matches package.json name", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { name: string };
  const fm = parseFrontmatter(readText("skills/autoresearch/SKILL.md"));
  assert.equal(fm["name"], pkg.name, "SKILL.md frontmatter name must match package.json name");
});

test("skills/autoresearch/ is under the path declared in pi.skills", () => {
  const pkg = JSON.parse(
    readFileSync(join(root, "package.json"), "utf-8"),
  ) as { pi: { skills: string[] } };
  // pi.skills = ["./skills"], so skills/autoresearch/ must be inside ./skills/
  const skillsBase = pkg.pi.skills[0].replace(/^\.\//, "");
  assert.ok(
    existsSync(join(root, skillsBase, "autoresearch/SKILL.md")),
    `SKILL.md must be discoverable under the pi.skills path "${skillsBase}"`,
  );
});
