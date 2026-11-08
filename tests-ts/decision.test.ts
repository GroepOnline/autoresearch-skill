import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeStats,
  decideValue,
  decideWithSamples,
  evaluateStopPolicy,
  permutationTestMedian,
  type DecisionHistory,
  type GuardrailInput,
} from "../extensions/autoresearch/decision.js";

interface FixtureCase {
  name: string;
  direction: "lower" | "higher";
  candidateSamples: number[];
  bestSamples: number[] | null;
  policy?: {
    min_effect_size_pct?: number;
    noise_floor_pct?: number;
    alpha?: number;
    min_samples?: number;
    require_significance?: boolean;
  };
  guardrails?: GuardrailInput[];
  history?: DecisionHistory;
  simplification?: { removes_complexity?: boolean; behavior_unchanged?: boolean };
  expectedAction: string;
  expectedOutcome: string;
}

function loadFixtures(): FixtureCase[] {
  const url = new URL("../tests/fixtures/decision-cases.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as FixtureCase[];
}

test("golden decision cases match the Python implementation", () => {
  const cases = loadFixtures();
  assert.ok(cases.length >= 8);
  for (const fixture of cases) {
    const result = decideWithSamples({
      candidateSamples: fixture.candidateSamples,
      bestSamples: fixture.bestSamples,
      direction: fixture.direction,
      policy: fixture.policy,
      guardrails: fixture.guardrails,
      history: fixture.history,
      simplification: fixture.simplification,
    });
    assert.equal(result.action, fixture.expectedAction, fixture.name);
    assert.equal(result.outcome, fixture.expectedOutcome, fixture.name);
  }
});

test("computeStats summarizes the sample distribution", () => {
  const stats = computeStats([98, 99, 100, 100, 101, 101, 102]);
  assert.equal(stats.count, 7);
  assert.equal(stats.median, 100);
  assert.equal(stats.min, 98);
  assert.equal(stats.max, 102);
  assert.ok(stats.cvPct > 0);
  assert.throws(() => computeStats([]));
});

test("permutation test separates clear improvements from overlap", () => {
  const separated = permutationTestMedian(
    [100, 101, 99, 102, 98, 100, 101],
    [120, 121, 119, 122, 118, 120, 121],
    "lower",
    0.05,
  );
  assert.equal(separated.significant, true);
  assert.ok(separated.pValue < 0.05);
  assert.match(separated.method, /exact_permutation_median/);

  const overlapping = permutationTestMedian(
    [100, 102, 98, 101, 99, 100, 101],
    [100, 99, 101, 100, 102, 98, 100],
    "lower",
    0.05,
  );
  assert.equal(overlapping.significant, false);

  const repeatedA = permutationTestMedian([1, 2, 3, 4], [5, 6, 7, 8], "lower", 0.05);
  const repeatedB = permutationTestMedian([1, 2, 3, 4], [5, 6, 7, 8], "lower", 0.05);
  assert.equal(repeatedA.pValue, repeatedB.pValue);
});

test("stop policy covers budgets, discards, and plateau", () => {
  assert.equal(evaluateStopPolicy({ remaining_runs: 0 }).stopped, true);
  assert.equal(evaluateStopPolicy({ remaining_minutes: 0 }).stopped, true);
  assert.equal(evaluateStopPolicy({ consecutive_discards: 5 }).stopped, true);
  assert.equal(evaluateStopPolicy({ runs_since_improvement: 10 }).stopped, true);
  assert.equal(evaluateStopPolicy({ consecutive_discards: 4, runs_since_improvement: 9 }).stopped, false);
});

test("decideWithSamples attaches evidence and rejects noise", () => {
  const kept = decideWithSamples({
    candidateSamples: [100, 101, 99, 102, 98, 100, 101],
    bestSamples: [120, 121, 119, 122, 118, 120, 121],
    direction: "lower",
  });
  assert.equal(kept.action, "keep");
  assert.equal(kept.policyVersion, 3);
  const evidence = kept.evidence as Record<string, any>;
  assert.equal(evidence.candidate.count, 7);
  assert.equal(evidence.best.median, 120);
  assert.equal(evidence.significance.significant, true);

  const noisy = decideWithSamples({
    candidateSamples: [10, 80, 30, 120, 5, 90],
    bestSamples: [50, 55, 45, 60, 52, 48],
    direction: "lower",
    policy: { noise_floor_pct: 10 },
  });
  assert.equal(noisy.action, "stop");
  assert.equal(noisy.outcome, "noisy");
});

test("decideValue keeps at the threshold boundary like decideWithSamples", () => {
  assert.equal(decideValue({ candidate: 90, best: 100, direction: "lower" }).action, "keep");
  // improvement exactly at the threshold is a keep, matching
  // decideWithSamples and benchmark-policy.md (improvement_pct >= threshold);
  // 12.5% of 80 is binary-exact so both sides compare identically.
  assert.equal(decideValue({ candidate: 70, best: 80, direction: "lower", minEffectSizePct: 12.5 }).action, "keep");
  assert.equal(decideValue({ candidate: 70.01, best: 80, direction: "lower", minEffectSizePct: 12.5 }).action, "discard");
  assert.equal(decideValue({ candidate: 100, direction: "lower" }).action, "baseline");
  assert.equal(decideValue({ candidate: 50, best: 100, direction: "lower", testsPassed: false }).action, "discard");
  assert.equal(decideValue({ candidate: 50, best: 100, direction: "lower", noisy: true }).action, "stop");
});
