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
  options: { cwd?: string; stdio?: "pipe" | "inherit" | "ignore" } = {}
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
    (err: unknown) => err instanceof Error
  );
});

test("run() re-throws spawnSync errors (e.g. command not found)", () => {
  assert.throws(
    () => run("__definitely_does_not_exist__", []),
    (err: unknown) => err instanceof Error
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
// Tests for npm pack JSON filename handling. npm is authoritative because
// scoped package names are sanitized in tarball filenames.
// ---------------------------------------------------------------------------

function tarballPathFromPackJson(outDir: string, raw: string): string {
  const packed = JSON.parse(raw) as Array<{ filename?: string }>;
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
    throw new Error("npm pack did not return exactly one tarball filename");
  }
  return join(outDir, packed[0].filename);
}

test("tarball path uses npm's scoped-package filename", () => {
  const actual = tarballPathFromPackJson(
    "/dist",
    JSON.stringify([{ filename: "groeponline-pi-autoresearch-1.2.0.tgz" }])
  );
  assert.equal(
    actual.replaceAll("\\", "/"),
    "/dist/groeponline-pi-autoresearch-1.2.0.tgz"
  );
});

test("tarball path rejects malformed npm pack output", () => {
  assert.throws(() => tarballPathFromPackJson("/dist", "[]"));
  assert.throws(() => tarballPathFromPackJson("/dist", JSON.stringify([{}])));
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
      `Expected error "${message}" to propagate, but it was silently ignored`
    );
  }
});
