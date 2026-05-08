import assert from "node:assert/strict";
import test from "node:test";
import { decideMetric } from "../extensions/autoresearch/tools.js";

test("decideMetric handles negative lower-is-better metrics correctly", () => {
  const worse = decideMetric({ direction: "lower", candidate: -98, best: -100, min_effect_size_pct: 1 });
  assert.equal(worse.action, "discard");
  assert.ok((worse.improvement_pct ?? 0) < 0);

  const better = decideMetric({ direction: "lower", candidate: -103, best: -100, min_effect_size_pct: 1 });
  assert.equal(better.action, "keep");
  assert.ok((better.improvement_pct ?? 0) >= 1);
});

test("decideMetric handles negative higher-is-better metrics correctly", () => {
  const worse = decideMetric({ direction: "higher", candidate: -103, best: -100, min_effect_size_pct: 1 });
  assert.equal(worse.action, "discard");
  assert.ok((worse.improvement_pct ?? 0) < 0);

  const better = decideMetric({ direction: "higher", candidate: -98, best: -100, min_effect_size_pct: 1 });
  assert.equal(better.action, "keep");
  assert.ok((better.improvement_pct ?? 0) >= 1);
});
