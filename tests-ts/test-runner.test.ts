import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyNode = process.env.AUTORESEARCH_LEGACY_NODE;

/** Build a temporary runner project and remove it when the test finishes. */
function fixture(t: TestContext, files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), "autoresearch runner "));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "scripts"));
  mkdirSync(join(cwd, "tests-ts"));
  copyFileSync(join(root, "scripts/run-ts-tests.mjs"), join(cwd, "scripts/run-ts-tests.mjs"));
  copyFileSync(
    join(root, "scripts/node-test-concurrency.mjs"),
    join(cwd, "scripts/node-test-concurrency.mjs")
  );
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "junction");
  writeFileSync(join(cwd, "package.json"), '{"type":"module"}');
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(cwd, "tests-ts", name), source);
  }
  return cwd;
}

/** Run the fixture from outside its root to verify cwd-independent discovery. */
function run(cwd: string, nodeExecutable = process.execPath) {
  const env = { ...process.env };
  // These are independent CLI runs, not children of this Node test coordinator.
  delete env.NODE_TEST_CONTEXT;
  // Deliberately start outside the fixture: discovery must use the script's root.
  return spawnSync(nodeExecutable, [join(cwd, "scripts/run-ts-tests.mjs")], {
    cwd: tmpdir(),
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

test("test concurrency capability matches supported Node release boundaries", () => {
  const versions = [
    "18.18.2",
    "18.19.0",
    "18.20.0",
    "19.9.0",
    "20.0.0",
    "20.9.0",
    "20.10.0",
    "20.99.0",
    "21.0.0",
    "22.0.0",
    "not-a-version",
  ];
  const moduleUrl = new URL("../scripts/node-test-concurrency.mjs", import.meta.url).href;
  const probe = `
    import { supportsTestConcurrency } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(${JSON.stringify(versions)}.map(supportsTestConcurrency)));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
    encoding: "utf-8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    false,
    true,
    true,
    false,
    false,
    false,
    true,
    true,
    true,
    true,
    false,
  ]);
});

test(
  "pre-flag Node runs isolated files sequentially and stops after the first failure",
  { skip: !legacyNode },
  (t) => {
    const cwd = fixture(t, {
      "a first.test.ts": `
        import test from "node:test";
        test("legacy first fixture", () => {
          process.env.AUTORESEARCH_LEGACY_FIXTURE = "must not leak";
        });
      `,
      "b second.test.ts": `
        import assert from "node:assert/strict";
        import test from "node:test";
        test("legacy second fixture", () => {
          assert.equal(process.env.AUTORESEARCH_LEGACY_FIXTURE, undefined);
        });
      `,
      "c failure.test.ts": `
        import assert from "node:assert/strict";
        import test from "node:test";
        test("legacy intentional failure", () => assert.equal(1, 2));
      `,
      "d after-failure.test.ts": `
        import test from "node:test";
        test("must not run after failure", () => {});
      `,
    });
    const result = run(cwd, legacyNode);
    const output = result.stdout + result.stderr;
    assert.ifError(result.error);
    assert.equal(result.status, 1, output);
    assert.match(output, /== tests-ts\/a first\.test\.ts ==/);
    assert.match(output, /legacy first fixture/);
    assert.match(output, /== tests-ts\/b second\.test\.ts ==/);
    assert.match(output, /legacy second fixture/);
    assert.match(output, /== tests-ts\/c failure\.test\.ts ==/);
    assert.match(output, /legacy intentional failure/);
    assert.doesNotMatch(output, /d after-failure\.test\.ts/);
  }
);

test("test runner discovers all TS files with spaces and preserves process isolation", (t) => {
  const cwd = fixture(t, {
    "a first.test.ts": `
      import test from "node:test";
      test("first fixture", () => {
        console.log("fixture-pid", process.pid);
        process.env.AUTORESEARCH_RUNNER_FIXTURE = "must not leak";
      });
    `,
    "z second.test.ts": `
      import assert from "node:assert/strict";
      import test from "node:test";
      const answer: number = 42;
      test("second fixture", () => {
        console.log("fixture-pid", process.pid);
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
  const pids = [...result.stdout.matchAll(/fixture-pid (\d+)/g)].map((match) => match[1]);
  assert.equal(pids.length, 2, result.stdout);
  assert.equal(new Set(pids).size, 2, "test files must run in distinct processes");
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
