import assert from "node:assert/strict";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseStartBudgets, paths, readState } from "../extensions/autoresearch/state.js";
import { dashboardRows, footerText, statusText } from "../extensions/autoresearch/ui.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "pi-autoresearch-test-"));
}

test("readState summarizes baseline, keep decisions, and footer text", () => {
  const cwd = tempProject();
  writeFileSync(paths(cwd).jsonl, [
    JSON.stringify({
      type: "config",
      schema_version: 1,
      name: "optimize-loop",
      metric: "latency_ms",
      direction: "lower",
      unit: "ms",
      created_at: "2026-05-06T12:00:00Z",
    }),
    JSON.stringify({ type: "result", run: 1, metric: "latency_ms", median: 100, timestamp: "t" }),
    JSON.stringify({ type: "decision", run: 1, action: "baseline", reason: "baseline", timestamp: "t" }),
    JSON.stringify({ type: "result", run: 2, metric: "latency_ms", median: 91, timestamp: "t", description: "tiny simplification" }),
    JSON.stringify({ type: "decision", run: 2, action: "keep", reason: "improved", timestamp: "t" }),
  ].join("\n") + "\n");

  const state = readState(cwd);
  assert.equal(state.parseErrors.length, 0);
  assert.equal(state.runCount, 2);
  assert.equal(state.baselineMetric, 100);
  assert.equal(state.bestMetric, 91);
  assert.equal(state.bestRun, 2);
  assert.match(footerText(state), /best:91ms/);
  assert.match(statusText(state), /Autoresearch: optimize-loop/);

  const rows = dashboardRows(state);
  assert.ok(rows.some(row => row.includes("tiny simplification")));
});

test("readState reports JSONL parse errors instead of hiding them", () => {
  const cwd = tempProject();
  writeFileSync(paths(cwd).jsonl, "{not json}\n");

  const state = readState(cwd);
  assert.ok(state.parseErrors.some(error => error.includes("invalid JSON")));
  assert.match(footerText(state), /parse error/);
  assert.match(statusText(state), /bevat fouten/);
});

test("readState validates protocol parity with Python helper", () => {
  const cwd = tempProject();
  writeFileSync(paths(cwd).jsonl, [
    JSON.stringify({ type: "result", run: 1, metric: "latency_ms", median: 100, timestamp: "t" }),
    JSON.stringify({ type: "config", name: "missing-required", metric: "latency_ms", direction: "lower" }),
    JSON.stringify({ type: "result", run: 1, metric: "latency_ms", median: 90, timestamp: "t" }),
    JSON.stringify({ type: "decision", run: 99, action: "keep", reason: "no result", timestamp: "t" }),
  ].join("\n") + "\n");

  const state = readState(cwd);
  assert.ok(state.parseErrors.some(error => error.includes("first non-empty event")));
  assert.ok(state.parseErrors.some(error => error.includes("config.schema_version")));
  assert.ok(state.parseErrors.some(error => error.includes("config.created_at")));
  assert.ok(state.parseErrors.some(error => error.includes("duplicate result.run 1")));
  assert.ok(state.parseErrors.some(error => error.includes("no preceding result")));
});

test("readState cache invalidates when runtime artifacts change", () => {
  const cwd = tempProject();

  assert.equal(readState(cwd).config, null);

  writeFileSync(paths(cwd).jsonl, [
    JSON.stringify({
      type: "config",
      schema_version: 1,
      name: "cached-session",
      metric: "score",
      direction: "higher",
      created_at: "2026-05-06T12:00:00Z",
    }),
  ].join("\n") + "\n");

  assert.equal(readState(cwd).config?.name, "cached-session");
  assert.equal(readState(cwd).isPaused, false);

  writeFileSync(paths(cwd).sentinel, "paused\n");
  assert.equal(readState(cwd).isPaused, true);

  unlinkSync(paths(cwd).sentinel);
  assert.equal(readState(cwd).isPaused, false);
});

test("parseStartBudgets defaults invalid values and accepts explicit values", () => {
  assert.deepEqual(parseStartBudgets([]), { maxRuns: 5, maxMinutes: 30 });
  assert.deepEqual(parseStartBudgets(["12", "45"]), { maxRuns: 12, maxMinutes: 45 });
  assert.deepEqual(parseStartBudgets(["0", "nope"]), { maxRuns: 5, maxMinutes: 30 });
});
