import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";

test("comparison benchmark script runs successfully", () => {
  const output = execSync("node scripts/benchmark-comparison.mjs", {
    cwd: process.cwd(),
    encoding: "utf-8",
  });

  // Check that output contains expected sections
  assert.ok(output.includes("Autoresearch System Comparison"));
  assert.ok(output.includes("Overview"));
  assert.ok(output.includes("Detailed Comparison"));
  assert.ok(output.includes("Summary Metrics"));
  assert.ok(output.includes("Feature Analysis"));
  assert.ok(output.includes("Recommendations"));
  assert.ok(output.includes("Conclusion"));
});

test("comparison benchmark outputs valid METRIC lines", () => {
  const output = execSync("node scripts/benchmark-comparison.mjs", {
    cwd: process.cwd(),
    encoding: "utf-8",
  });

  // Check for METRIC lines in the output
  const metricLines = output.split("\n").filter((line) => line.startsWith("METRIC "));

  assert.ok(metricLines.length > 0, "Should output at least one METRIC line");

  // Verify METRIC format: METRIC name=value direction=...
  for (const line of metricLines) {
    const match = line.match(/^METRIC (\w+)=([\d.]+) direction=(\w+)$/);
    assert.ok(match, `METRIC line should match expected format: ${line}`);
    const [, name, value, direction] = match;
    assert.ok(name, "METRIC should have a name");
    assert.ok(!isNaN(parseFloat(value)), "METRIC value should be a number");
    assert.ok(
      ["higher", "lower", "neutral"].includes(direction),
      "METRIC direction should be higher, lower, or neutral"
    );
  }
});

test("comparison benchmark includes both systems", () => {
  const output = execSync("node scripts/benchmark-comparison.mjs", {
    cwd: process.cwd(),
    encoding: "utf-8",
  });

  // Check that both systems are mentioned
  assert.ok(output.includes("Pi Autoresearch"));
  assert.ok(output.includes("Droid Autoresearch"));
  assert.ok(output.includes("Factory.ai"));
});

test("comparison benchmark produces scores", () => {
  const output = execSync("node scripts/benchmark-comparison.mjs", {
    cwd: process.cwd(),
    encoding: "utf-8",
  });

  // Check that scores are present
  assert.ok(output.includes("Overall Score"));
  assert.ok(output.match(/\d+\.\d+\/\d+\.\d+/), "Should have score format like X.X/Y.Y");
});

test("comparison benchmark includes feature comparison table", () => {
  const output = execSync("node scripts/benchmark-comparison.mjs", {
    cwd: process.cwd(),
    encoding: "utf-8",
  });

  // Check for markdown table format
  assert.ok(output.includes("|"), "Should include markdown table");
  assert.ok(output.includes("Criterion"), "Should have Criterion column");
  assert.ok(output.includes("Weight"), "Should have Weight column");
  assert.ok(output.includes("Pi"), "Should have Pi column");
  assert.ok(output.includes("Droid"), "Should have Droid column");
});
