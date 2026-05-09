import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildContextInjection, parseStartBudgets, paths, readState } from "../extensions/autoresearch/state.js";
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

test("readState rejects decisions that do not follow a result", () => {
  const cwd = tempProject();
  writeFileSync(paths(cwd).jsonl, [
    JSON.stringify({
      type: "config",
      schema_version: 1,
      name: "optimize-loop",
      metric: "latency_ms",
      direction: "lower",
      created_at: "2026-05-06T12:00:00Z",
    }),
    JSON.stringify({ type: "decision", run: 1, action: "keep", reason: "missing result", timestamp: "t" }),
  ].join("\n") + "\n");

  const state = readState(cwd);
  assert.ok(state.parseErrors.some(error => error.includes("no preceding result")));
});

test("readState rejects config without required schema fields", () => {
  const cwd = tempProject();
  writeFileSync(paths(cwd).jsonl, [
    JSON.stringify({
      type: "config",
      name: "optimize-loop",
      metric: "latency_ms",
      direction: "lower",
    }),
  ].join("\n") + "\n");

  const state = readState(cwd);
  assert.ok(state.parseErrors.some(error => error.includes("schema_version must be 1")));
  assert.ok(state.parseErrors.some(error => error.includes("created_at is required")));
});

test("buildContextInjection writes a snapshot from current state", () => {
  const cwd = tempProject();
  writeFileSync(paths(cwd).context, "# Autoresearch\n", "utf-8");
  writeFileSync(paths(cwd).jsonl, [
    JSON.stringify({
      type: "config",
      schema_version: 1,
      name: "optimize-loop",
      metric: "latency_ms",
      direction: "lower",
      created_at: "2026-05-06T12:00:00Z",
    }),
    JSON.stringify({ type: "result", run: 1, metric: "latency_ms", median: 100, timestamp: "t" }),
    JSON.stringify({ type: "decision", run: 1, action: "baseline", reason: "baseline", timestamp: "t" }),
  ].join("\n") + "\n");

  const state = readState(cwd);
  const injection = buildContextInjection(cwd, state);
  assert.ok(injection?.includes("Autoresearch Loop"));

  const snapshot = JSON.parse(readFileSync(paths(cwd).snapshot, "utf-8")) as { counts: { runs: number }; resumeInstruction: string };
  assert.equal(snapshot.counts.runs, 1);
  assert.match(snapshot.resumeInstruction, /continue from run 2/);
});

test("parseStartBudgets defaults invalid values and accepts explicit values", () => {
  assert.deepEqual(parseStartBudgets([]), { maxRuns: 5, maxMinutes: 30 });
  assert.deepEqual(parseStartBudgets(["12", "45"]), { maxRuns: 12, maxMinutes: 45 });
  assert.deepEqual(parseStartBudgets(["0", "nope"]), { maxRuns: 5, maxMinutes: 30 });
});
