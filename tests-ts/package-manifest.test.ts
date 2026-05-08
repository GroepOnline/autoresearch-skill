/**
 * Tests for the package.json changes introduced in this PR.
 *
 * Covered changes:
 * - Version bumped to 1.0.0
 * - `private` field removed (package is now publishable)
 * - New metadata fields: description, license, author, homepage, bugs, repository
 * - Repository URL updated from GroepChef to OnlineChef
 * - New keywords added: pi-skill, agent-skill, optimization, coding-agent
 * - `skills/` and `docs/` added to the `files` array
 * - `AUDIT.md` added to the `files` array
 * - `pi.skills` changed from ["."] to ["./skills"]
 * - New `package` script pointing at package-clean.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as Record<
  string,
  unknown
>;

// ---------------------------------------------------------------------------
// Version and publishability
// ---------------------------------------------------------------------------

test("package version is 1.0.0", () => {
  assert.equal(pkg["version"], "1.0.0");
});

test("package is not marked private (publishable)", () => {
  // The `private` field must be absent or falsy so `npm publish` is allowed.
  assert.ok(
    !pkg["private"],
    "package.json must not have private:true for a publishable package",
  );
});

// ---------------------------------------------------------------------------
// Required metadata fields added in this PR
// ---------------------------------------------------------------------------

test("package has a description", () => {
  assert.equal(typeof pkg["description"], "string");
  assert.ok((pkg["description"] as string).length > 0);
});

test("package has MIT license", () => {
  assert.equal(pkg["license"], "MIT");
});

test("package has author field", () => {
  assert.equal(pkg["author"], "OnlineChef");
});

test("package homepage points to OnlineChef organisation", () => {
  const homepage = pkg["homepage"] as string;
  assert.ok(homepage.includes("OnlineChef"), `Expected homepage to reference OnlineChef, got: ${homepage}`);
});

test("package bugs URL points to OnlineChef organisation", () => {
  const bugs = pkg["bugs"] as { url: string };
  assert.ok(typeof bugs === "object" && bugs !== null);
  assert.ok(
    bugs.url.includes("OnlineChef"),
    `Expected bugs.url to reference OnlineChef, got: ${bugs.url}`,
  );
});

test("package repository URL points to OnlineChef organisation", () => {
  const repo = pkg["repository"] as { type: string; url: string };
  assert.ok(typeof repo === "object" && repo !== null);
  assert.equal(repo.type, "git");
  assert.ok(
    repo.url.includes("OnlineChef"),
    `Expected repository.url to reference OnlineChef, got: ${repo.url}`,
  );
});

test("package repository URL no longer references GroepChef", () => {
  const repo = pkg["repository"] as { url: string };
  assert.ok(
    !repo.url.includes("GroepChef"),
    `repository.url must not reference old GroepChef org, got: ${repo.url}`,
  );
});

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

test("keywords include all required discovery terms", () => {
  const keywords = pkg["keywords"] as string[];
  assert.ok(Array.isArray(keywords));

  const required = [
    "pi-package",
    "pi-extension",
    "pi-skill",
    "agent-skill",
    "autoresearch",
    "benchmark",
    "optimization",
    "coding-agent",
  ];

  for (const kw of required) {
    assert.ok(keywords.includes(kw), `Expected keyword "${kw}" to be present in package.json`);
  }
});

// ---------------------------------------------------------------------------
// Files array
// ---------------------------------------------------------------------------

test("files array includes skills/ directory", () => {
  const files = pkg["files"] as string[];
  assert.ok(Array.isArray(files));
  assert.ok(files.includes("skills/"), `Expected "skills/" in files array`);
});

test("files array includes docs/ directory", () => {
  const files = pkg["files"] as string[];
  assert.ok(files.includes("docs/"), `Expected "docs/" in files array`);
});

test("files array includes AUDIT.md", () => {
  const files = pkg["files"] as string[];
  assert.ok(files.includes("AUDIT.md"), `Expected "AUDIT.md" in files array`);
});

test("files array retains pre-existing entries", () => {
  const files = pkg["files"] as string[];
  // These entries existed before the PR and must not have been removed.
  const retained = ["extensions/", "SKILL.md", "README.md", "LICENSE"];
  for (const entry of retained) {
    assert.ok(files.includes(entry), `Expected pre-existing file entry "${entry}" to still be present`);
  }
});

// ---------------------------------------------------------------------------
// Pi manifest
// ---------------------------------------------------------------------------

test("pi.skills is ['./skills'] (not ['.'])", () => {
  const pi = pkg["pi"] as { extensions: string[]; skills: string[] };
  assert.ok(typeof pi === "object" && pi !== null);
  assert.deepEqual(pi.skills, ["./skills"]);
});

test("pi.extensions still points to the native extension entrypoint", () => {
  const pi = pkg["pi"] as { extensions: string[] };
  assert.ok(
    pi.extensions.includes("./extensions/autoresearch/index.ts"),
    "pi.extensions must include the native extension entrypoint",
  );
});

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

test("scripts.package is defined and points to package-clean.mjs", () => {
  const scripts = pkg["scripts"] as Record<string, string>;
  assert.ok(typeof scripts["package"] === "string");
  assert.ok(
    scripts["package"].includes("package-clean.mjs"),
    `Expected scripts.package to run package-clean.mjs, got: ${scripts["package"]}`,
  );
});

test("scripts.package and scripts.package:clean point to the same script", () => {
  const scripts = pkg["scripts"] as Record<string, string>;
  assert.equal(
    scripts["package"],
    scripts["package:clean"],
    "Both 'package' and 'package:clean' scripts must resolve to the same command",
  );
});

// ---------------------------------------------------------------------------
// Regression: ensure no accidental field regressions
// ---------------------------------------------------------------------------

test("package name is still pi-autoresearch", () => {
  assert.equal(pkg["name"], "pi-autoresearch");
});

test("package type is module (ESM)", () => {
  assert.equal(pkg["type"], "module");
});

test("package requires node >= 18", () => {
  const engines = pkg["engines"] as { node: string };
  assert.ok(typeof engines === "object" && engines !== null);
  assert.ok(
    engines.node.includes("18"),
    `Expected engines.node to require >=18, got: ${engines.node}`,
  );
});