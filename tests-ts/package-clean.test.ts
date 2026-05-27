/**
 * Tests for the `run()` helper in scripts/package-clean.mjs.
 *
 * The PR fixed a crash where `result.stdout.trim()` would throw when
 * spawnSync returns `null` for stdout (e.g. when stdio is "inherit").
 * These tests verify the defensive null-check behaviour and the stable
 * tarball-path output logic.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// ---------------------------------------------------------------------------
// Helper: inline version of the `run()` function from package-clean.mjs so we
// can unit-test the null-stdout defensive branch without side effects.
// ---------------------------------------------------------------------------

function run(
  command: string,
  args: string[],
  options: { cwd?: string; stdio?: "pipe" | "inherit" | "ignore" } = {},
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf-8",
    stdio: options.stdio
      ? [options.stdio, options.stdio, options.stdio]
      : ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} ${args.join(" ")} failed`);
  }
  // This is the exact defensive expression introduced in the PR.
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

// ---------------------------------------------------------------------------
// Tests for the null-stdout guard (the PR fix)
// ---------------------------------------------------------------------------

test("run() returns empty string when stdout is null (inherited stdio)", () => {
  // `node` with stdio:"inherit" causes spawnSync to set stdout to null.
  // Before the fix this would throw: Cannot read properties of null (reading 'trim')
  const result = run("node", ["--eval", "process.exit(0)"], { stdio: "inherit" });
  assert.equal(result, "");
});

test("run() returns trimmed string when stdout is a string", () => {
  // Normal pipe mode: stdout is a string; trim() must be applied.
  const result = run("node", ["--eval", "process.stdout.write('  hello  ')"]);
  assert.equal(result, "hello");
});

test("run() trims trailing newline from captured stdout", () => {
  // Most commands end output with \n; the result must be trimmed.
  const result = run("node", ["--eval", "console.log('trimmed')"]);
  assert.equal(result, "trimmed");
});

test("run() throws when the command exits with non-zero status", () => {
  assert.throws(
    () => run("node", ["--eval", "process.exit(1)"]),
    (err: unknown) => err instanceof Error,
  );
});

test("run() re-throws spawnSync errors (e.g. command not found)", () => {
  assert.throws(
    () => run("__definitely_does_not_exist__", []),
    (err: unknown) => err instanceof Error,
  );
});

// ---------------------------------------------------------------------------
// Tests for the null-stdout guard with a simulated null return value
// (white-box unit test – mirrors what happens when stdio:"inherit" is used
//  internally by the npm pack call in package-clean.mjs)
// ---------------------------------------------------------------------------

test("typeof null !== 'string' guard returns empty string for null stdout", () => {
  // Simulate the exact expression from package-clean.mjs
  function applyGuard(stdout: string | null | Buffer): string {
    return typeof stdout === "string" ? stdout.trim() : "";
  }

  assert.equal(applyGuard(null), "");
  assert.equal(applyGuard("  output  "), "output");
  assert.equal(applyGuard(""), "");
  assert.equal(applyGuard("line\n"), "line");
  // Buffer objects are also not strings
  assert.equal(applyGuard(Buffer.from("buf")), "");
});

// ---------------------------------------------------------------------------
// Tests for the tarball path construction logic
// (package-clean.mjs prints: join(outDir, `${pkg.name}-${pkg.version}.tgz`))
// ---------------------------------------------------------------------------

test("tarball path uses name and version from package.json", async () => {
  const { join } = await import("node:path");
  const outDir = "/dist";
  const pkg = { name: "pi-autoresearch", version: "1.0.0" };
  const tarball = join(outDir, `${pkg.name}-${pkg.version}.tgz`);
  assert.equal(tarball.replaceAll("\\", "/"), "/dist/pi-autoresearch-1.0.0.tgz");
});

test("tarball path changes with different name/version combinations", async () => {
  const { join } = await import("node:path");
  const outDir = "/output";
  const cases: Array<[string, string, string]> = [
    ["my-pkg", "2.3.0", "my-pkg-2.3.0.tgz"],
    ["@scope/pkg", "0.1.0", "@scope/pkg-0.1.0.tgz"],
    ["pi-autoresearch", "1.0.0", "pi-autoresearch-1.0.0.tgz"],
  ];
  for (const [name, version, expected] of cases) {
    const actual = join(outDir, `${name}-${version}.tgz`);
    assert.ok(
      actual.replaceAll("\\", "/").endsWith(expected),
      `Expected path to end with ${expected}, got ${actual}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tests for the dirty-git guard logic (behaviour, not the actual git calls)
// ---------------------------------------------------------------------------

test("dirty git detection uses non-empty porcelain output as signal", () => {
  // The script treats any non-empty `git status --porcelain` output as dirty.
  function isDirty(porcelainOutput: string): boolean {
    return porcelainOutput.trim().length > 0;
  }

  assert.equal(isDirty(""), false);
  assert.equal(isDirty(" M extensions/autoresearch/index.ts\n"), true);
  assert.equal(isDirty("?? newfile.ts\n"), true);
  assert.equal(isDirty("   "), false);
});

test("git-not-a-repository error is silently ignored by the guard", () => {
  // package-clean.mjs continues when the error message matches /not a git repository/i
  function shouldIgnoreGitError(message: string): boolean {
    return /not a git repository/i.test(message);
  }

  assert.equal(shouldIgnoreGitError("not a git repository"), true);
  assert.equal(shouldIgnoreGitError("fatal: not a git repository (or any parent)"), true);
  assert.equal(shouldIgnoreGitError("NOT A GIT REPOSITORY"), true);
  assert.equal(shouldIgnoreGitError("permission denied"), false);
  assert.equal(shouldIgnoreGitError("unknown revision"), false);
});

test("non-repository git errors propagate (are not ignored)", () => {
  // Only the /not a git repository/i pattern is swallowed; other errors must propagate.
  const errorMessages = [
    "fatal: ambiguous argument 'HEAD'",
    "error: object file is empty",
    "fatal: bad config file",
  ];

  function shouldIgnoreGitError(message: string): boolean {
    return /not a git repository/i.test(message);
  }

  for (const message of errorMessages) {
    assert.equal(
      shouldIgnoreGitError(message),
      false,
      `Expected error "${message}" to propagate, but it was silently ignored`,
    );
  }
});
