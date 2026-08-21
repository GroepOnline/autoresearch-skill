/**
 * @module runner
 * Main autoresearch improvement loop.
 *
 * Orchestrates the full workflow:
 * 1. Initialize state and config
 * 2. Test LLM connection
 * 3. Run baseline benchmark
 * 4. Loop: find low-scoring skills -> analyze -> ask LLM -> apply -> measure -> decide
 * 5. Write dashboard and summary
 *
 * Uses all other modules: scorer, validator, analyzer, llm, decision, skill-finder, dashboard.
 *
 * FIX: Original llamarunner.mjs had a duplicate JSONL append bug at lines 586 and 617
 * where the same result was appended twice. This version appends the result once
 * with its final status, and the decision as a separate entry.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { scoreContent } from "./scorer.mjs";
import { analyzeSkill } from "./analyzer.mjs";
import { createLlmClient, applyFixes } from "./llm.mjs";
import { decideImprovement } from "./decision.mjs";
import { getSkillFiles } from "./skill-finder.mjs";
import { saveDashboard } from "./dashboard.mjs";

/**
 * @typedef {Object} RunnerOptions
 * @property {"llama"|"ollama"} [provider="llama"]
 * @property {string} [model]
 * @property {string} [host]
 * @property {number} [maxRuns=10]
 * @property {number} [maxMinutes=60]
 * @property {string} [targetDir]
 * @property {string|null} [skillFilter]
 * @property {boolean} [dryRun=false]
 */

/**
 * Run the autoresearch improvement loop.
 *
 * @param {RunnerOptions} [options]
 */
export async function run(options = {}) {
  const provider = options.provider || "llama";
  const dryRun = options.dryRun || false;
  const defaultPort = provider === "ollama" ? 11434 : 8081;
  const host = options.host || process.env.LLAMA_HOST || `http://localhost:${defaultPort}`;
  const model =
    options.model || (provider === "ollama" ? "qwen3:4b-nothink" : "Qwen3-4B-Q4_K_M.gguf");
  const maxRuns = options.maxRuns || 10;
  const maxMinutes = options.maxMinutes || 60;
  const targetDir = options.targetDir || resolve(process.cwd(), "../skill-grinder");
  const skillFilter = options.skillFilter || null;

  const stateDir = join(targetDir, ".autoresearch");
  const jsonlPath = join(stateDir, "autoresearch.jsonl");
  const dashboardPath = join(stateDir, "autoresearch-dashboard.md");

  // ── State ────────────────────────────────────────────────────────────────
  let config = null;
  const results = [];
  const decisions = [];
  let runCount = 0;
  let keptCount = 0;
  let discardedCount = 0;
  let crashedCount = 0;
  let bestMetric = null;
  let bestRun = null;
  let baselineMetric = null;
  let consecutiveDiscards = 0;
  let runsSinceLastImprovement = 0;

  // ── State persistence helpers ────────────────────────────────────────────
  function ensureStateDir() {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
  }

  function appendJsonl(entry) {
    appendFileSync(jsonlPath, JSON.stringify(entry) + "\n");
  }

  function loadState() {
    if (!existsSync(jsonlPath)) return;

    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "config") {
          config = entry;
        } else if (entry.type === "result") {
          results.push(entry);
          runCount = entry.run;
          if (entry.status === "keep") {
            keptCount++;
            consecutiveDiscards = 0;
            runsSinceLastImprovement = 0;
            if (
              bestMetric === null ||
              (config?.direction === "higher" ? entry.value > bestMetric : entry.value < bestMetric)
            ) {
              bestMetric = entry.value;
              bestRun = entry.run;
            }
          } else if (entry.status === "discard") {
            discardedCount++;
            consecutiveDiscards++;
            runsSinceLastImprovement++;
          } else if (entry.status === "crash") {
            crashedCount++;
          }
        } else if (entry.type === "decision") {
          decisions.push(entry);
        }
      } catch (e) {
        console.error("JSONL parse error:", e.message);
      }
    }

    if (config) {
      baselineMetric = results.find((r) => r.status === "measured")?.value ?? null;
    }
  }

  function saveConfig(cfg) {
    config = cfg;
    appendJsonl({ type: "config", ...cfg, created_at: new Date().toISOString() });
  }

  // ── Benchmark ────────────────────────────────────────────────────────────
  function measureSkillQuality(filePath) {
    const content = readFileSync(filePath, "utf-8");
    return scoreContent(content);
  }

  function measureAllSkills() {
    const skillFiles = getSkillFiles(targetDir);
    const scored = [];
    for (const f of skillFiles) {
      try {
        const { score } = measureSkillQuality(f);
        scored.push({ file: f, score });
      } catch {
        scored.push({ file: f, score: 0 });
      }
    }
    const avg = scored.reduce((a, s) => a + s.score, 0) / (scored.length || 1);
    return { scored, avg };
  }

  function runBenchmark(targetFile) {
    if (targetFile) {
      const { score } = measureSkillQuality(targetFile);
      return { value: score, direction: "higher" };
    }
    const { avg } = measureAllSkills();
    return { value: avg, direction: "higher" };
  }

  // ── Banner ───────────────────────────────────────────────────────────────
  const providerLabel = provider === "ollama" ? "Ollama" : "llama.cpp";
  console.log(
    "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557"
  );
  console.log(
    `\u2551   Autoresearch Runner (${providerLabel})${dryRun ? " [DRY RUN]" : ""}`.padEnd(59) +
      "\u2551"
  );
  console.log(
    "\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563"
  );
  console.log(`\u2551  Model:     ${model.padEnd(43)}\u2551`);
  console.log(`\u2551  Provider:  ${providerLabel.padEnd(43)}\u2551`);
  console.log(`\u2551  LLM Host:  ${host.padEnd(43)}\u2551`);
  console.log(`\u2551  Target:    ${targetDir.slice(-43).padEnd(43)}\u2551`);
  console.log(`\u2551  Max Runs:  ${String(maxRuns).padEnd(43)}\u2551`);
  console.log(`\u2551  Max Mins:  ${String(maxMinutes).padEnd(43)}\u2551`);
  console.log(
    "\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d"
  );
  console.log();

  // ── Init ─────────────────────────────────────────────────────────────────
  ensureStateDir();
  loadState();

  const llm = createLlmClient({ host, model, provider });

  // Create config if not exists
  if (!config) {
    const cfg = {
      name: "skill-grinder-quality",
      metric: "skill_quality",
      direction: "higher",
      unit: "score",
      min_effect_size_pct: 2,
      noise_floor_pct: 5,
      max_runs: maxRuns,
      max_minutes: maxMinutes,
    };
    if (dryRun) {
      config = cfg;
      console.log("[DRY RUN] Would create config:", cfg);
    } else {
      saveConfig(cfg);
      console.log("Config created:", cfg);
    }
  }

  // Write PID file so Stop hook can detect active runs
  const pidFile = join(stateDir, "runner.pid");
  writeFileSync(pidFile, String(process.pid));
  process.on("exit", () => {
    try {
      unlinkSync(pidFile);
    } catch {}
  });

  // ── Test LLM connection ─────────────────────────────────────────────────
  console.log("\nTesting LLM connection...");
  try {
    const testResp = await llm.chat(
      [
        { role: "system", content: "Respond in one word. /no_think" },
        { role: "user", content: "Say hello." },
      ],
      { maxTokens: 20 }
    );
    console.log("LLM response:", testResp.slice(0, 50));
  } catch (e) {
    console.error("LLM connection failed:", e.message);
    process.exit(1);
  }

  // ── Baseline ─────────────────────────────────────────────────────────────
  if (baselineMetric === null) {
    console.log("\nRunning baseline benchmark...");
    const baseline = runBenchmark();
    if (baseline) {
      baselineMetric = baseline.value;
      const result = {
        run: ++runCount,
        metric: "skill_quality",
        value: baseline.value,
        status: "measured",
        description: "baseline measurement",
        timestamp: Date.now(),
      };
      results.push(result);
      if (!dryRun) {
        appendJsonl(result);
      }
      console.log(`Baseline: ${baseline.value}`);

      decisions.push({
        run: runCount,
        action: "baseline",
        reason: "first measurement",
        timestamp: new Date().toISOString(),
      });
      if (!dryRun) {
        appendJsonl({
          type: "decision",
          run: runCount,
          action: "baseline",
          reason: "first measurement",
        });
      }
    }
  }

  // ── Main improvement loop ────────────────────────────────────────────────
  const startTime = Date.now();
  while (runCount < maxRuns) {
    const elapsedMinutes = (Date.now() - startTime) / 60_000;
    if (elapsedMinutes >= maxMinutes) {
      console.log(`\nTime budget exhausted (${maxMinutes} min)`);
      break;
    }

    // Stop conditions
    if (consecutiveDiscards >= 5) {
      console.log("\n5 consecutive discards \u2014 stopping");
      break;
    }
    if (runsSinceLastImprovement >= 10) {
      console.log("\n10 runs without improvement \u2014 stopping");
      break;
    }

    console.log(
      `\n\u2500\u2500\u2500 Run ${runCount + 1}/${maxRuns} (${elapsedMinutes.toFixed(1)} min elapsed) \u2500\u2500\u2500`
    );

    // Find a skill to improve
    const skillFiles = getSkillFiles(targetDir, { filter: skillFilter });
    if (skillFiles.length === 0) {
      console.log("No SKILL.md files found");
      break;
    }

    // Score all skills and pick low-scoring ones preferentially
    const scoredSkills = skillFiles
      .map((f) => {
        try {
          const m = runBenchmark(f);
          return { file: f, score: m?.value ?? 0 };
        } catch {
          return { file: f, score: 100 };
        }
      })
      .filter((s) => s.score < 90); // Only target skills below 90

    let targetFile;
    if (scoredSkills.length > 0) {
      // Weight toward lowest scores (exponential bias)
      scoredSkills.sort((a, b) => a.score - b.score);
      const weights = scoredSkills.map((_, i) => Math.pow(scoredSkills.length - i, 2));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalWeight;
      for (let i = 0; i < scoredSkills.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          targetFile = scoredSkills[i].file;
          break;
        }
      }
      targetFile = targetFile || scoredSkills[0].file;
      console.log(
        `Smart pick: ${targetFile.split("/").slice(-2, -1)[0]} (score: ${scoredSkills.find((s) => s.file === targetFile)?.score})`
      );
    } else {
      console.log("All skills above 90 \u2014 nothing to improve");
      break;
    }

    const analysis = analyzeSkill(targetFile);

    if (!analysis.hasIssues) {
      console.log(`${targetFile}: no issues found, skipping`);
      continue;
    }

    console.log(`Target: ${targetFile}`);
    console.log(`Issues: ${analysis.issues.join(", ")}`);

    // Ask LLM for improvement
    console.log("Asking LLM for improvement...");
    try {
      // Measure BEFORE improvement
      const beforeMeasurement = runBenchmark(targetFile);
      const beforeScore = beforeMeasurement?.value ?? 0;
      console.log(`Score before: ${beforeScore}`);

      const fixes = await llm.getFixes(analysis.content, analysis.issues.join("\n"));
      const improved = applyFixes(analysis.content, fixes);

      if (!improved || improved.length < 100) {
        console.log("LLM returned empty/too short response, skipping");
        continue;
      }

      // Apply improvement
      const backup = analysis.content;
      if (dryRun) {
        console.log(
          `[DRY RUN] Would write improvement to ${targetFile} (${improved.length} chars)`
        );
      } else {
        writeFileSync(targetFile, improved);
      }
      console.log("Improvement applied, running benchmark...");

      // Measure AFTER improvement
      const afterMeasurement = runBenchmark(targetFile);
      if (!afterMeasurement) {
        if (!dryRun) {
          console.log("Benchmark failed, reverting...");
          writeFileSync(targetFile, backup);
        } else {
          console.log("[DRY RUN] Benchmark failed, would revert");
        }
        continue;
      }

      const afterScore = afterMeasurement.value;
      console.log(`Score after: ${afterScore} (was: ${beforeScore})`);

      // Decide based on per-skill before/after comparison
      const decision = decideImprovement(beforeScore, afterScore, config);

      // Build result with final status (FIX: no duplicate JSONL append)
      const result = {
        run: ++runCount,
        metric: "skill_quality",
        value: afterScore,
        status: decision.action === "keep" ? "keep" : "discard",
        description: `improved ${targetFile.split("/").pop()}`,
        timestamp: Date.now(),
      };

      console.log(`Decision: ${decision.action} \u2014 ${decision.reason}`);

      if (decision.action === "keep") {
        bestMetric = afterScore;
        bestRun = runCount;
        keptCount++;
        consecutiveDiscards = 0;
        runsSinceLastImprovement = 0;
        if (dryRun) {
          console.log("[DRY RUN] Would KEEP improvement");
        } else {
          console.log("KEPT \u2014 improvement saved");
        }
      } else {
        discardedCount++;
        consecutiveDiscards++;
        runsSinceLastImprovement++;
        if (dryRun) {
          console.log("[DRY RUN] Would DISCARD and revert");
        } else {
          writeFileSync(targetFile, backup);
          console.log("DISCARDED \u2014 reverted");
        }
      }

      // FIX: Append result ONCE with final status, not twice
      results.push(result);
      if (!dryRun) {
        appendJsonl(result);
      }

      decisions.push({
        run: runCount,
        action: decision.action,
        reason: decision.reason,
        timestamp: new Date().toISOString(),
      });
      if (!dryRun) {
        appendJsonl({
          type: "decision",
          run: runCount,
          action: decision.action,
          reason: decision.reason,
        });
      }
    } catch (e) {
      console.error("Run error:", e.message);
      crashedCount++;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(
    "\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557"
  );
  console.log("\u2551   Autoresearch Complete                                \u2551");
  console.log(
    "\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563"
  );
  console.log(`\u2551  Runs:       ${String(runCount).padEnd(42)}\u2551`);
  console.log(`\u2551  Kept:       ${String(keptCount).padEnd(42)}\u2551`);
  console.log(`\u2551  Discarded:  ${String(discardedCount).padEnd(42)}\u2551`);
  console.log(`\u2551  Crashed:    ${String(crashedCount).padEnd(42)}\u2551`);
  console.log(
    `\u2551  Best:       ${bestMetric !== null ? String(bestMetric).padEnd(42) : "N/A".padEnd(42)}\u2551`
  );
  console.log(
    `\u2551  Best Run:   ${bestRun !== null ? String(bestRun).padEnd(42) : "N/A".padEnd(42)}\u2551`
  );
  console.log(
    "\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d"
  );

  // Save dashboard
  saveDashboard(
    dashboardPath,
    {
      runCount,
      keptCount,
      discardedCount,
      crashedCount,
      bestMetric,
      bestRun,
      baselineMetric,
      results,
    },
    dryRun
  );
}
