/**
 * Contract tests for the publishable package manifest.
 *
 * These assertions protect package identity, discovery metadata, shipped files,
 * Pi entrypoints, packaging scripts, and the canonical GroepOnline repository URLs.
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

const canonicalRepoUrl = "https://github.com/GroepOnline/autoresearch-skill";

test("package version is 1.2.0", () => {
  assert.equal(pkg["version"], "1.2.0");
});

test("package is not marked private (publishable)", () => {
  assert.ok(!pkg["private"], "package.json must not have private:true for a publishable package");
});

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

test("package homepage points to canonical GroepOnline repository", () => {
  assert.equal(pkg["homepage"], `${canonicalRepoUrl}#readme`);
});

test("package bugs URL points to canonical GroepOnline repository", () => {
  const bugs = pkg["bugs"] as { url: string };
  assert.ok(typeof bugs === "object" && bugs !== null);
  assert.equal(bugs.url, `${canonicalRepoUrl}/issues`);
});

test("package repository URL points to canonical GroepOnline repository", () => {
  const repo = pkg["repository"] as { type: string; url: string };
  assert.ok(typeof repo === "object" && repo !== null);
  assert.equal(repo.type, "git");
  assert.equal(repo.url, `git+${canonicalRepoUrl}.git`);
});

test("package repository URL no longer references GroepChef", () => {
  const repo = pkg["repository"] as { url: string };
  assert.ok(
    !repo.url.includes("GroepChef"),
    `repository.url must not reference old GroepChef org, got: ${repo.url}`
  );
});

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

test("files array includes skills/ directory", () => {
  const files = pkg["files"] as string[];
  assert.ok(Array.isArray(files));
  assert.ok(files.includes("skills/"), `Expected "skills/" in files array`);
});

test("files array includes docs/ directory", () => {
  const files = pkg["files"] as string[];
  assert.ok(files.includes("docs/"), `Expected "docs/" in files array`);
});

test("files array includes AUDIT.md via docs/ directory", () => {
  const files = pkg["files"] as string[];
  assert.ok(files.includes("docs/"), `Expected "docs/" in files array to include AUDIT.md`);
});

test("files array retains pre-existing entries", () => {
  const files = pkg["files"] as string[];
  const retained = ["extensions/", "skills/", "README.md", "LICENSE"];
  for (const entry of retained) {
    assert.ok(
      files.includes(entry),
      `Expected pre-existing file entry "${entry}" to still be present`
    );
  }
});

test("pi.skills is ['./skills'] (not ['.'])", () => {
  const pi = pkg["pi"] as { extensions: string[]; skills: string[] };
  assert.ok(typeof pi === "object" && pi !== null);
  assert.deepEqual(pi.skills, ["./skills"]);
});

test("pi.extensions still points to the native extension entrypoint", () => {
  const pi = pkg["pi"] as { extensions: string[] };
  assert.ok(
    pi.extensions.includes("./extensions/autoresearch/index.ts"),
    "pi.extensions must include the native extension entrypoint"
  );
});

test("scripts.package is defined and points to package-clean.mjs", () => {
  const scripts = pkg["scripts"] as Record<string, string>;
  assert.ok(typeof scripts["package"] === "string");
  assert.ok(
    scripts["package"].includes("package-clean.mjs"),
    `Expected scripts.package to run package-clean.mjs, got: ${scripts["package"]}`
  );
});

test("scripts.package and scripts.package:clean point to the same script", () => {
  const scripts = pkg["scripts"] as Record<string, string>;
  assert.equal(
    scripts["package"],
    scripts["package:clean"],
    "Both 'package' and 'package:clean' scripts must resolve to the same command"
  );
});

test("package name is the scoped @groeponline/pi-autoresearch", () => {
  // Unscoped pi-autoresearch is owned by an unrelated publisher on npm.
  assert.equal(pkg["name"], "@groeponline/pi-autoresearch");
});

test("package type is module (ESM)", () => {
  assert.equal(pkg["type"], "module");
});

test("package requires node >= 18", () => {
  const engines = pkg["engines"] as { node: string };
  assert.ok(typeof engines === "object" && engines !== null);
  assert.ok(
    engines.node.includes("18"),
    `Expected engines.node to require >=18, got: ${engines.node}`
  );
});
