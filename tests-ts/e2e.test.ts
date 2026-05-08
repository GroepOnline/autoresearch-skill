import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureStartPrereqs } from "../extensions/autoresearch/commands.js";
import { paths, readState } from "../extensions/autoresearch/state.js";
import { dashboardRows } from "../extensions/autoresearch/ui.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "pi-autoresearch-e2e-test-"));
}

test("e2e fixture: new -> filled contract -> start -> result -> decision -> dashboard", () => {
  const cwd = tempProject();
  execSync("git init", { cwd, stdio: "ignore" });
  const p = paths(cwd);
  mkdirSync(p.dir, { recursive: true });

  // /autoresearch new output after the user has filled placeholders.
  writeFileSync(
    p.context,
    [
      "# Autoresearch: Optimize Parser",
      "",
      "## Objective",
      "Reduce parser latency without changing behavior.",
      "",
      "## Metrics",
      "- **Primary**: latency_ms (ms, lower is better)",
      "",
      "## How to Run",
      "`./.agents/autoresearch/autoresearch.sh` prints METRIC latency_ms values.",
      "",
      "## Files in Scope",
      "- src/parser.ts",
      "",
      "## Off Limits",
      "- none",
    ].join("\n")
  );
  writeFileSync(
    p.benchmark,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo 'METRIC latency_ms=100 direction=lower'",
    ].join("\n")
  );
  writeFileSync(p.worklog, "# Worklog\n");

  const prereq = ensureStartPrereqs(cwd, p);
  assert.equal(prereq.blockMsg, undefined);
  assert.equal(prereq.state.config?.metric, "latency_ms");
  assert.equal(prereq.state.config?.direction, "lower");

  appendFileSync(
    p.jsonl,
    [
      JSON.stringify({
        type: "result",
        run: 1,
        metric: "latency_ms",
        median: 100,
        timestamp: "2026-05-08T10:00:00Z",
        description: "baseline",
      }),
      JSON.stringify({
        type: "decision",
        run: 1,
        action: "baseline",
        reason: "baseline measurement",
        timestamp: "2026-05-08T10:01:00Z",
      }),
      JSON.stringify({
        type: "result",
        run: 2,
        metric: "latency_ms",
        median: 92,
        timestamp: "2026-05-08T10:02:00Z",
        description: "remove redundant parse allocation",
      }),
      JSON.stringify({
        type: "decision",
        run: 2,
        action: "keep",
        reason: "improved above threshold",
        timestamp: "2026-05-08T10:03:00Z",
      }),
    ].join("\n") + "\n"
  );

  const state = readState(cwd);
  assert.deepEqual(state.parseErrors, []);
  assert.equal(state.runCount, 2);
  assert.equal(state.bestRun, 2);
  assert.equal(state.bestMetric, 92);
  assert.ok(dashboardRows(state).some((row) => row.includes("remove redundant")));
});
