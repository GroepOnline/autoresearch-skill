import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(t: TestContext, files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), "autoresearch runner "));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "scripts"));
  mkdirSync(join(cwd, "tests-ts"));
  copyFileSync(join(root, "scripts/run-ts-tests.mjs"), join(cwd, "scripts/run-ts-tests.mjs"));
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "junction");
  writeFileSync(join(cwd, "package.json"), '{"type":"module"}');
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(cwd, "tests-ts", name), source);
  }
  return cwd;
}

function run(cwd: string) {
  const env = { ...process.env };
  // These are independent CLI runs, not children of this Node test coordinator.
  delete env.NODE_TEST_CONTEXT;
  // Deliberately start outside the fixture: discovery must use the script's root.
  return spawnSync(process.execPath, [join(cwd, "scripts/run-ts-tests.mjs")], {
    cwd: tmpdir(),
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

test("test runner discovers all TS files with spaces and preserves process isolation", (t) => {
  const cwd = fixture(t, {
    "a first.test.ts": `
      import test from "node:test";
      test("first fixture", () => {
        process.env.AUTORESEARCH_RUNNER_FIXTURE = "must not leak";
      });
    `,
    "z second.test.ts": `
      import assert from "node:assert/strict";
      import test from "node:test";
      const answer: number = 42;
      test("second fixture", () => {
        assert.equal(answer, 42);
        assert.equal(process.env.AUTORESEARCH_RUNNER_FIXTURE, undefined);
      });
    `,
    "ignored.ts": 'throw new Error("not a test file");',
  });
  const result = run(cwd);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /first fixture/);
  assert.match(result.stdout, /second fixture/);
});

test("test runner propagates assertion failures", (t) => {
  const cwd = fixture(t, {
    "failure.test.ts": `
      import assert from "node:assert/strict";
      import test from "node:test";
      test("intentional fixture failure", () => assert.equal(1, 2));
    `,
  });
  const result = run(cwd);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /intentional fixture failure/);
});

test("test runner propagates TypeScript transform errors", (t) => {
  const cwd = fixture(t, { "syntax.test.ts": "const value: = ;" });
  const result = run(cwd);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /TransformError/);
});

test("test runner fails closed when no test files are discovered", (t) => {
  const cwd = fixture(t, { "ignored.ts": 'throw new Error("not a test file");' });
  const result = run(cwd);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No TypeScript tests found/);
});
