import assert from "node:assert/strict";
import test from "node:test";
import { decideMetric } from "../extensions/autoresearch/tools.js";

// Import internal functions for testing - we need to export them first or test via the public API
// Since these are internal, we'll test them through the tool execute functions indirectly
// For now, let's test more scenarios of decideMetric and add integration tests

test("decideMetric handles negative lower-is-better metrics correctly", () => {
  const worse = decideMetric({
    direction: "lower",
    candidate: -98,
    best: -100,
    min_effect_size_pct: 1,
  });
  assert.equal(worse.action, "discard");
  assert.ok((worse.improvement_pct ?? 0) < 0);

  const better = decideMetric({
    direction: "lower",
    candidate: -103,
    best: -100,
    min_effect_size_pct: 1,
  });
  assert.equal(better.action, "keep");
  assert.ok((better.improvement_pct ?? 0) >= 1);
});

test("decideMetric handles negative higher-is-better metrics correctly", () => {
  const worse = decideMetric({
    direction: "higher",
    candidate: -103,
    best: -100,
    min_effect_size_pct: 1,
  });
  assert.equal(worse.action, "discard");
  assert.ok((worse.improvement_pct ?? 0) < 0);

  const better = decideMetric({
    direction: "higher",
    candidate: -98,
    best: -100,
    min_effect_size_pct: 1,
  });
  assert.equal(better.action, "keep");
  assert.ok((better.improvement_pct ?? 0) >= 1);
});

test("decideMetric handles baseline (no best value)", () => {
  const result = decideMetric({ direction: "lower", candidate: 100, best: null });
  assert.equal(result.action, "baseline");
  assert.equal(result.reason, "first measurement becomes baseline");
  assert.equal(result.improvement_pct, 0);

  const result2 = decideMetric({ direction: "higher", candidate: 50, best: undefined });
  assert.equal(result2.action, "baseline");
});

test("decideMetric rejects tests_passed=false", () => {
  const result = decideMetric({
    direction: "lower",
    candidate: 50,
    best: 100,
    tests_passed: false,
  });
  assert.equal(result.action, "discard");
  assert.ok(result.reason.includes("correctness"));
});

test("decideMetric stops on noisy benchmark", () => {
  const result = decideMetric({ direction: "lower", candidate: 50, best: 100, noisy: true });
  assert.equal(result.action, "stop");
  assert.ok(result.reason.includes("noise"));
});

test("decideMetric handles zero best value correctly", () => {
  // For lower direction with zero best - only strict improvement allowed
  const better = decideMetric({
    direction: "lower",
    candidate: -1,
    best: 0,
    min_effect_size_pct: 1,
  });
  assert.equal(better.action, "keep");

  const worse = decideMetric({ direction: "lower", candidate: 1, best: 0, min_effect_size_pct: 1 });
  assert.equal(worse.action, "discard");

  // For higher direction with zero best
  const better2 = decideMetric({
    direction: "higher",
    candidate: 1,
    best: 0,
    min_effect_size_pct: 1,
  });
  assert.equal(better2.action, "keep");

  const worse2 = decideMetric({
    direction: "higher",
    candidate: -1,
    best: 0,
    min_effect_size_pct: 1,
  });
  assert.equal(worse2.action, "discard");
});

test("decideMetric validates inputs", () => {
  assert.throws(
    () => decideMetric({ direction: "lower", candidate: NaN, best: 100 }),
    /finite number/
  );
  assert.throws(
    () => decideMetric({ direction: "invalid" as unknown as "lower", candidate: 50, best: 100 }),
    /lower or higher/
  );
  assert.throws(
    () => decideMetric({ direction: "lower", candidate: 50, best: NaN }),
    /finite number/
  );
});

test("decideMetric respects min_effect_size_pct threshold", () => {
  // 5% improvement should be kept with 3% threshold
  const result = decideMetric({
    direction: "lower",
    candidate: 95,
    best: 100,
    min_effect_size_pct: 3,
  });
  assert.equal(result.action, "keep");
  assert.ok((result.improvement_pct ?? 0) >= 3);

  // 2% improvement should be discarded with 3% threshold
  const result2 = decideMetric({
    direction: "lower",
    candidate: 98,
    best: 100,
    min_effect_size_pct: 3,
  });
  assert.equal(result2.action, "discard");
});

test("decideMetric handles higher direction correctly", () => {
  // Higher is better: candidate > best = improvement
  const better = decideMetric({
    direction: "higher",
    candidate: 110,
    best: 100,
    min_effect_size_pct: 3,
  });
  assert.equal(better.action, "keep");
  assert.ok((better.improvement_pct ?? 0) >= 3);

  const worse = decideMetric({
    direction: "higher",
    candidate: 90,
    best: 100,
    min_effect_size_pct: 3,
  });
  assert.equal(worse.action, "discard");
});

test("decideMetric handles noise_floor_pct", () => {
  // When noise_floor is higher than min_effect_size, it becomes the effective threshold
  const result = decideMetric({
    direction: "lower",
    candidate: 97,
    best: 100,
    min_effect_size_pct: 3,
    noise_floor_pct: 5,
  });
  // 3% improvement < 5% noise floor, should be discarded
  assert.equal(result.action, "discard");
});

test("decideMetric returns improvement_pct in result", () => {
  const result = decideMetric({ direction: "lower", candidate: 80, best: 100 });
  assert.ok(result.improvement_pct !== undefined);
  assert.equal(result.improvement_pct, 20); // (100-80)/100 * 100 = 20%
});

test("decideMetric handles negative best with positive candidate", () => {
  // Negative best: -100, candidate: -90 (worse for lower, better for higher)
  const worse = decideMetric({
    direction: "lower",
    candidate: -90,
    best: -100,
    min_effect_size_pct: 1,
  });
  assert.equal(worse.action, "discard");

  const betterHigher = decideMetric({
    direction: "higher",
    candidate: -90,
    best: -100,
    min_effect_size_pct: 1,
  });
  assert.equal(betterHigher.action, "keep");
});
