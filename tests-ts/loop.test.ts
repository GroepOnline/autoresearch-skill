import assert from "node:assert/strict";
import test from "node:test";
import { evaluateContinuation, type LoopState } from "../extensions/autoresearch/loop.js";
import { parseStartBudgets } from "../extensions/autoresearch/state.js";
import type { ArState } from "../extensions/autoresearch/types.js";

function baseState(overrides: Partial<ArState> = {}): ArState {
  return {
    config: { type: "config", name: "test", metric: "latency_ms", direction: "lower" },
    results: [],
    decisions: [],
    parseErrors: [],
    runCount: 0,
    keptCount: 0,
    discardedCount: 0,
    crashedCount: 0,
    bestMetric: null,
    bestRun: null,
    baselineMetric: null,
    currentSegment: 0,
    isPaused: false,
    hasIdeas: false,
    ...overrides,
  };
}

function baseLoop(overrides: Partial<LoopState> = {}): LoopState {
  return {
    mode: "ralph",
    maxRuns: 5,
    maxMinutes: 30,
    startedAt: Date.now() - 60_000, // 1 min elapsed
    runsAtStart: 0,
    ...overrides,
  };
}

test("loop continues when budget remains and state is healthy", () => {
  const cont = evaluateContinuation(baseState({ runCount: 2 }), baseLoop(), Date.now());
  assert.equal(cont.shouldContinue, true);
  assert.equal(cont.runsUsed, 2);
  assert.equal(cont.remainingRuns, 3);
});

test("loop stops when run budget exhausted", () => {
  const cont = evaluateContinuation(baseState({ runCount: 5 }), baseLoop({ maxRuns: 5 }), Date.now());
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /run budget/);
});

test("loop stops when time budget exhausted", () => {
  const cont = evaluateContinuation(
    baseState(),
    baseLoop({ maxMinutes: 0.01, startedAt: Date.now() - 10_000 }),
    Date.now()
  );
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /time budget/);
});

test("loop stops when paused", () => {
  const cont = evaluateContinuation(baseState({ isPaused: true }), baseLoop(), Date.now());
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /paused/);
});

test("loop stops when JSONL has parse errors", () => {
  const cont = evaluateContinuation(baseState({ parseErrors: ["line 1: invalid JSON"] }), baseLoop(), Date.now());
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /JSONL/);
});

test("loop stops on explicit stop decision", () => {
  const state = baseState({
    runCount: 3,
    decisions: [{ type: "decision", run: 3, action: "stop", reason: "noise too high", timestamp: "t" }],
  });
  const cont = evaluateContinuation(state, baseLoop(), Date.now());
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /stop decision/);
});

test("ralph defaults: parseStartBudgets with implied args gives 3 runs / 20 min", () => {
  const budgets = parseStartBudgets(["3", "20"]);
  assert.equal(budgets.maxRuns, 3);
  assert.equal(budgets.maxMinutes, 20);
});
