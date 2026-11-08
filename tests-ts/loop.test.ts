import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContinuationMessage,
  evaluateContinuation,
  recordLoopProgress,
  restoreLoopProgress,
  type LoopState,
} from "../extensions/autoresearch/loop.js";
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
    maxConsecutiveDiscards: 5,
    consecutiveDiscards: 0,
    maxRunsWithoutImprovement: 10,
    runsSinceLastImprovement: 0,
    trackedRuns: 0,
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
  const cont = evaluateContinuation(
    baseState({ runCount: 5 }),
    baseLoop({ maxRuns: 5 }),
    Date.now()
  );
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
  const cont = evaluateContinuation(
    baseState({ parseErrors: ["line 1: invalid JSON"] }),
    baseLoop(),
    Date.now()
  );
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /JSONL/);
});

test("loop stops on explicit stop decision", () => {
  const state = baseState({
    runCount: 3,
    decisions: [
      { type: "decision", run: 3, action: "stop", reason: "noise too high", timestamp: "t" },
    ],
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

test("loop stops after max consecutive discards", () => {
  const cont = evaluateContinuation(
    baseState({ runCount: 6 }),
    baseLoop({ maxRuns: 10, consecutiveDiscards: 5, maxConsecutiveDiscards: 5 }),
    Date.now()
  );
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /consecutive discards/);
});

test("loop continues when discards below limit", () => {
  const cont = evaluateContinuation(
    baseState({ runCount: 4 }),
    baseLoop({ maxRuns: 10, consecutiveDiscards: 4, maxConsecutiveDiscards: 5 }),
    Date.now()
  );
  assert.equal(cont.shouldContinue, true);
});

test("loop stops on plateau — maxRunsWithoutImprovement reached", () => {
  const cont = evaluateContinuation(
    baseState({ runCount: 12 }),
    baseLoop({ maxRuns: 20, runsSinceLastImprovement: 10, maxRunsWithoutImprovement: 10 }),
    Date.now()
  );
  assert.equal(cont.shouldContinue, false);
  assert.match(cont.stopReason!, /plateau/);
});

test("loop continues when plateau limit not yet reached", () => {
  const cont = evaluateContinuation(
    baseState({ runCount: 10 }),
    baseLoop({ maxRuns: 20, runsSinceLastImprovement: 9, maxRunsWithoutImprovement: 10 }),
    Date.now()
  );
  assert.equal(cont.shouldContinue, true);
});

test("recordLoopProgress counts a completed discard only once", () => {
  const state = baseState({
    runCount: 1,
    decisions: [{ type: "decision", run: 1, action: "discard", reason: "worse", timestamp: "t1" }],
  });
  const loop = baseLoop();

  assert.equal(recordLoopProgress(loop, state, 1_000), true);
  assert.equal(loop.trackedRuns, 1);
  assert.equal(loop.consecutiveDiscards, 1);
  assert.equal(loop.runsSinceLastImprovement, 1);
  assert.equal(loop.lastRunTs, 1_000);

  assert.equal(recordLoopProgress(loop, state, 2_000), false);
  assert.equal(loop.trackedRuns, 1);
  assert.equal(loop.consecutiveDiscards, 1);
  assert.equal(loop.runsSinceLastImprovement, 1);
  assert.equal(loop.lastRunTs, 1_000);
});

test("recordLoopProgress derives counters from persisted decisions", () => {
  const loop = baseLoop({
    trackedRuns: 1,
    consecutiveDiscards: 99,
    runsSinceLastImprovement: 99,
  });
  const state = baseState({
    runCount: 2,
    decisions: [
      { type: "decision", run: 1, action: "discard", reason: "worse", timestamp: "t1" },
      { type: "decision", run: 2, action: "discard", reason: "still worse", timestamp: "t2" },
    ],
  });

  assert.equal(recordLoopProgress(loop, state, 2_000), true);
  assert.equal(loop.trackedRuns, 2);
  assert.equal(loop.consecutiveDiscards, 2);
  assert.equal(loop.runsSinceLastImprovement, 2);
});

test("keep resets discard and plateau counters", () => {
  const loop = baseLoop({
    trackedRuns: 1,
    consecutiveDiscards: 1,
    runsSinceLastImprovement: 1,
  });
  const state = baseState({
    runCount: 2,
    decisions: [
      { type: "decision", run: 1, action: "discard", reason: "worse", timestamp: "t1" },
      { type: "decision", run: 2, action: "keep", reason: "better", timestamp: "t2" },
    ],
  });

  assert.equal(recordLoopProgress(loop, state, 2_000), true);
  assert.equal(loop.consecutiveDiscards, 0);
  assert.equal(loop.runsSinceLastImprovement, 0);
});

test("restoreLoopProgress reconstructs persisted counters after restart", () => {
  const loop = baseLoop({ runsAtStart: 2, trackedRuns: 0 });
  const state = baseState({
    runCount: 5,
    decisions: [
      { type: "decision", run: 3, action: "keep", reason: "better", timestamp: "t3" },
      { type: "decision", run: 4, action: "discard", reason: "worse", timestamp: "t4" },
      { type: "decision", run: 5, action: "discard", reason: "worse", timestamp: "t5" },
    ],
  });

  restoreLoopProgress(loop, state);
  assert.equal(loop.trackedRuns, 3);
  assert.equal(loop.consecutiveDiscards, 2);
  assert.equal(loop.runsSinceLastImprovement, 2);
});

test("continuation prompt references centralized .autoresearch artifacts", () => {
  const state = baseState({
    runCount: 1,
    baselineMetric: 100,
    bestMetric: 95,
    bestRun: 1,
  });
  const loop = baseLoop();
  const cont = evaluateContinuation(state, loop, Date.now());
  const prompt = buildContinuationMessage(loop, cont, state);
  assert.match(prompt, /\.autoresearch\/autoresearch\.md/);
  assert.match(prompt, /\.autoresearch\/autoresearch\.jsonl/);
  assert.match(prompt, /\.autoresearch\/autoresearch\.sh/);
});
