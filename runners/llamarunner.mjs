#!/usr/bin/env node
/**
 * Standalone Autoresearch Runner for llama.cpp / Ollama
 *
 * Connects to llama.cpp (port 8081) or Ollama (port 11434) on bc-scan-arm
 * and runs autonomous skill improvement loops using the Ralph Wiggum mode.
 *
 * Usage:
 *   node llamarunner.mjs [--provider llama|ollama] [--model Qwen3-4B-Q4_K_M.gguf]
 *                        [--max-runs 10] [--max-minutes 60] [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

// ── Config ──────────────────────────────────────────────────────────────────

const PROVIDER = process.argv.find((_, i, a) => a[i - 1] === "--provider") || "llama";
const DRY_RUN = process.argv.includes("--dry-run");
const DEFAULT_PORT = PROVIDER === "ollama" ? 11434 : 8081;
const LLAMA_HOST = process.env.LLAMA_HOST || `http://localhost:${DEFAULT_PORT}`;
const MODEL = process.argv.find((_, i, a) => a[i - 1] === "--model") || (PROVIDER === "ollama" ? "qwen3:4b-nothink" : "Qwen3-4B-Q4_K_M.gguf");
const MAX_RUNS = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--max-runs") || "10");
const MAX_MINUTES = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--max-minutes") || "60");
const TARGET_DIR = process.argv.find((_, i, a) => a[i - 1] === "--target") || resolve(process.cwd(), "../skill-grinder");
const SKILL_FILTER = process.argv.find((_, i, a) => a[i - 1] === "--skill") || null; // comma-separated skill names
const STATE_DIR = join(TARGET_DIR, ".autoresearch");
const JSONL_PATH = join(STATE_DIR, "autoresearch.jsonl");
const DASHBOARD_PATH = join(STATE_DIR, "autoresearch-dashboard.md");

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ArConfig
 * @property {string} name
 * @property {string} metric
 * @property {"lower"|"higher"} direction
 * @property {string} unit
 * @property {number} min_effect_size_pct
 * @property {number} noise_floor_pct
 * @property {number} max_runs
 * @property {number} max_minutes
 */

/**
 * @typedef {Object} ArResult
 * @property {number} run
 * @property {string} metric
 * @property {number} value
 * @property {"measured"|"keep"|"discard"|"crash"} status
 * @property {string} description
 * @property {string} [commit]
 * @property {number} [timestamp]
 */

/**
 * @typedef {Object} ArDecision
 * @property {number} run
 * @property {"keep"|"discard"|"baseline"|"stop"} action
 * @property {string} reason
 * @property {string} [timestamp]
 */

// ── State ───────────────────────────────────────────────────────────────────

/** @type {ArConfig|null} */
let config = null;
/** @type {ArResult[]} */
let results = [];
/** @type {ArDecision[]} */
let decisions = [];
let runCount = 0;
let keptCount = 0;
let discardedCount = 0;
let crashedCount = 0;
let bestMetric = null;
let bestRun = null;
let baselineMetric = null;
let consecutiveDiscards = 0;
let runsSinceLastImprovement = 0;

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function appendJsonl(entry) {
  appendFileSync(JSONL_PATH, JSON.stringify(entry) + "\n");
}

function loadState() {
  if (!existsSync(JSONL_PATH)) return;

  const lines = readFileSync(JSONL_PATH, "utf-8").split("\n").filter(Boolean);
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
          if (bestMetric === null || (config?.direction === "higher" ? entry.value > bestMetric : entry.value < bestMetric)) {
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

// ── LLM ─────────────────────────────────────────────────────────────────────

async function llamaChat(messages, { maxTokens = 1024, temperature = 0.7 } = {}) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutMs = PROVIDER === "ollama" ? 120_000 : 300_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${LLAMA_HOST}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`LLM error ${resp.status}: ${text}`);
      }

      const data = await resp.json();
      const msg = data.choices[0]?.message;
      return msg?.content || msg?.reasoning_content || "";
    } catch (e) {
      const isRetryable = e.name === "AbortError" || e.message.includes("fetch failed") || e.message.includes("ECONNREFUSED");
      if (attempt < MAX_ATTEMPTS && isRetryable) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        console.log(`  Attempt ${attempt}/${MAX_ATTEMPTS} failed (${e.message}), retrying in ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function llmGetFixes(skillContent, issues) {
  const MAX_SKILL_CHARS = 2000;
  const truncated = skillContent.length > MAX_SKILL_CHARS
    ? skillContent.slice(0, MAX_SKILL_CHARS) + "\n\n[... truncated ...]"
    : skillContent;

  const maxTokens = PROVIDER === "ollama" ? 256 : 1024;

  return llamaChat([
    {
      role: "system",
      content: `You are a SKILL.md editor. Output ONLY the sections to ADD to the file, not the full file. Keep it minimal. Format: exactly the markdown content to append, nothing else. /no_think`,
    },
    {
      role: "user",
      content: `Current SKILL.md:\n\n${truncated}\n\nMissing sections:\n${issues}\n\nOutput ONLY the missing sections to append:`,
    },
  ], { maxTokens });
}

function applyFixes(originalContent, fixes) {
  if (!fixes || fixes.length < 20) return null;
  // Strip markdown code fences if present
  const cleaned = fixes.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
  if (!cleaned) return null;
  return originalContent.trimEnd() + "\n\n" + cleaned + "\n";
}

// ── Benchmark ───────────────────────────────────────────────────────────────

function runBenchmark(targetFile) {
  const tmpScript = `/tmp/autoresearch-bench-${process.pid}.mjs`;
  try {
    // Per-skill: measure content quality (not just header existence)
    // Global: average across all skills
    const measureScript = targetFile
      ? `import { readFileSync } from 'fs';
         const content = readFileSync('${targetFile}', 'utf-8');
         let score = 0;
         if (/^name:/m.test(content)) score += 10;
         if (/^description:/m.test(content)) score += 10;
         const rulesMatch = content.match(/## Rules[\\s\\S]*?(?=##|$)/);
         if (rulesMatch) {
           score += 10;
           const ruleLines = rulesMatch[0].split('\\n').filter(l => /^[-*]\\s|^\\d+\\.\\s/.test(l.trim()));
           score += Math.min(20, ruleLines.length * 4);
         }
         const examplesMatch = content.match(/## Examples?[\\s\\S]*?(?=##|$)/);
         if (examplesMatch) {
           score += 10;
           const exLines = examplesMatch[0].split('\\n').filter(l => l.trim().length > 5);
           score += Math.min(15, exLines.length * 3);
         }
         const commandsMatch = content.match(/## Commands?[\\s\\S]*?(?=##|$)/);
         if (commandsMatch) {
           score += 10;
           const cmdLines = commandsMatch[0].split('\\n').filter(l => /^[-*\\d]/.test(l.trim()));
           score += Math.min(15, cmdLines.length * 3);
         }
         console.log('METRIC skill_quality=' + score + ' direction=higher');`
      : `import { readdirSync, readFileSync } from 'fs';
         import { join } from 'path';
         const skills = [];
         function scan(dir) {
           for (const f of readdirSync(dir, { withFileTypes: true })) {
             const fp = join(dir, f.name);
             if (f.isDirectory() && !f.name.startsWith('.') && f.name !== 'node_modules') scan(fp);
             else if (f.name === 'SKILL.md') {
               const content = readFileSync(fp, 'utf-8');
               let score = 0;
               if (/^name:/m.test(content)) score += 10;
               if (/^description:/m.test(content)) score += 10;
               const rulesMatch = content.match(/## Rules[\\s\\S]*?(?=##|$)/);
               if (rulesMatch) {
                 score += 10;
                 const ruleLines = rulesMatch[0].split('\\n').filter(l => /^[-*\\d]/.test(l.trim()));
                 score += Math.min(20, ruleLines.length * 4);
               }
               const examplesMatch = content.match(/## Examples?[\\s\\S]*?(?=##|$)/);
               if (examplesMatch) {
                 score += 10;
                 const exLines = examplesMatch[0].split('\\n').filter(l => l.trim().length > 5);
                 score += Math.min(15, exLines.length * 3);
               }
               const commandsMatch = content.match(/## Commands?[\\s\\S]*?(?=##|$)/);
               if (commandsMatch) {
                 score += 10;
                 const cmdLines = commandsMatch[0].split('\\n').filter(l => /^[-*\\d]/.test(l.trim()));
                 score += Math.min(15, cmdLines.length * 3);
               }
               skills.push({ file: fp, score });
             }
           }
         }
         scan('.');
         const avg = skills.reduce((a, s) => a + s.score, 0) / skills.length;
         console.log('METRIC skill_quality=' + avg.toFixed(1) + ' direction=higher');`;

    writeFileSync(tmpScript, measureScript);
    const result = execSync(
      `cd "${TARGET_DIR}" && node "${tmpScript}"`,
      { encoding: "utf-8", timeout: 30000 }
    );

    const metricMatch = result.match(/METRIC\s+skill_quality=([\d.]+)\s+direction=(\w+)/);
    if (metricMatch) {
      return {
        value: parseFloat(metricMatch[1]),
        direction: metricMatch[2],
        details: result,
      };
    }
    return null;
  } catch (e) {
    console.error("Benchmark error:", e.message);
    return null;
  } finally {
    try { unlinkSync(tmpScript); } catch {}
  }
}

// ── Decision Engine ─────────────────────────────────────────────────────────

function decideMetric(result) {
  if (!config) return { action: "stop", reason: "no config" };
  if (baselineMetric === null) {
    baselineMetric = result.value;
    return { action: "baseline", reason: "first measurement" };
  }

  const delta = result.value - baselineMetric;
  const deltaPct = (delta / Math.abs(baselineMetric)) * 100;
  const isImprovement =
    config.direction === "higher" ? delta > 0 : delta < 0;
  const aboveNoise = Math.abs(deltaPct) >= (config.noise_floor_pct || 5);
  const aboveEffect = Math.abs(deltaPct) >= (config.min_effect_size_pct || 2);

  if (isImprovement && aboveNoise && aboveEffect) {
    return { action: "keep", reason: `improved by ${deltaPct.toFixed(1)}%` };
  }
  if (isImprovement && !aboveNoise) {
    return { action: "discard", reason: `improvement ${deltaPct.toFixed(1)}% below noise floor` };
  }
  return { action: "discard", reason: `no improvement (${deltaPct.toFixed(1)}%)` };
}

// ── Skill Analysis ──────────────────────────────────────────────────────────

function getSkillFiles() {
  try {
    const result = execSync(
      `find "${TARGET_DIR}" -name "SKILL.md" -type f -not -path "*/_imported/*" -not -path "*/_archive/*" -not -path "*/_testing/*" | head -200`,
      { encoding: "utf-8", timeout: 10000 }
    );
    let files = result.trim().split("\n").filter(Boolean);
    if (SKILL_FILTER) {
      const names = SKILL_FILTER.split(",").map(s => s.trim().toLowerCase());
      files = files.filter(f => {
        const dir = f.replace(/\/SKILL\.md$/, "").split("/").pop().toLowerCase();
        return names.includes(dir);
      });
    }
    return files;
  } catch {
    return [];
  }
}

function analyzeSkill(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const issues = [];

  if (!/^name:/m.test(content)) issues.push("Missing 'name' field in frontmatter");
  if (!/^description:/m.test(content)) issues.push("Missing 'description' field in frontmatter");
  if (!/## Rules/.test(content)) issues.push("Missing '## Rules' section");
  if (!/## Examples?/.test(content)) issues.push("Missing '## Examples' section");
  if (!/## Commands?/.test(content)) issues.push("Missing '## Commands' section");
  if (content.length < 200) issues.push("Skill file is too short (<200 chars)");
  if (content.length > 10000) issues.push("Skill file is too long (>10000 chars)");

  return { filePath, content, issues, hasIssues: issues.length > 0 };
}

// ── Main Loop ───────────────────────────────────────────────────────────────

async function main() {
  const providerLabel = PROVIDER === "ollama" ? "Ollama" : "llama.cpp";
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║   Autoresearch Runner (${providerLabel})${DRY_RUN ? " [DRY RUN]" : ""}`.padEnd(59) + "║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Model:     ${MODEL.padEnd(43)}║`);
  console.log(`║  Provider:  ${providerLabel.padEnd(43)}║`);
  console.log(`║  LLM Host:  ${LLAMA_HOST.padEnd(43)}║`);
  console.log(`║  Target:    ${TARGET_DIR.slice(-43).padEnd(43)}║`);
  console.log(`║  Max Runs:  ${String(MAX_RUNS).padEnd(43)}║`);
  console.log(`║  Max Mins:  ${String(MAX_MINUTES).padEnd(43)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  ensureStateDir();
  loadState();

  // Create config if not exists
  if (!config) {
    const cfg = {
      name: "skill-grinder-quality",
      metric: "skill_quality",
      direction: "higher",
      unit: "score",
      min_effect_size_pct: 2,
      noise_floor_pct: 5,
      max_runs: MAX_RUNS,
      max_minutes: MAX_MINUTES,
    };
    if (DRY_RUN) {
      config = cfg;
      console.log("[DRY RUN] Would create config:", cfg);
    } else {
      saveConfig(cfg);
      console.log("Config created:", cfg);
    }
  }

  // Write PID file so Stop hook can detect active runs
  const PID_FILE = join(STATE_DIR, "runner.pid");
  writeFileSync(PID_FILE, String(process.pid));
  process.on("exit", () => { try { unlinkSync(PID_FILE); } catch {} });

  // Test LLM connection
  console.log("\nTesting LLM connection...");
  try {
    const testResp = await llamaChat([{ role: "system", content: "Respond in one word. /no_think" }, { role: "user", content: "Say hello." }], { maxTokens: 20 });
    console.log("LLM response:", testResp.slice(0, 50));
  } catch (e) {
    console.error("LLM connection failed:", e.message);
    process.exit(1);
  }

  // Run baseline
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
      if (!DRY_RUN) {
        appendJsonl(result);
      }
      console.log(`Baseline: ${baseline.value}`);

      const decision = decideMetric(result);
      decisions.push({ run: runCount, action: "baseline", reason: decision.reason, timestamp: new Date().toISOString() });
      if (!DRY_RUN) {
        appendJsonl({ type: "decision", run: runCount, action: "baseline", reason: decision.reason });
      }
    }
  }

  // Main improvement loop
  const startTime = Date.now();
  while (runCount < MAX_RUNS) {
    const elapsedMinutes = (Date.now() - startTime) / 60_000;
    if (elapsedMinutes >= MAX_MINUTES) {
      console.log(`\nTime budget exhausted (${MAX_MINUTES} min)`);
      break;
    }

    // Stop conditions
    if (consecutiveDiscards >= 5) {
      console.log("\n5 consecutive discards — stopping");
      break;
    }
    if (runsSinceLastImprovement >= 10) {
      console.log("\n10 runs without improvement — stopping");
      break;
    }

    console.log(`\n─── Run ${runCount + 1}/${MAX_RUNS} (${elapsedMinutes.toFixed(1)} min elapsed) ───`);

    // Find a skill to improve
    const skillFiles = getSkillFiles();
    if (skillFiles.length === 0) {
      console.log("No SKILL.md files found");
      break;
    }

    // Pick a random skill (Ralph Wiggum: naive exploration)
    const targetFile = skillFiles[Math.floor(Math.random() * skillFiles.length)];
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

      const fixes = await llmGetFixes(analysis.content, analysis.issues.join("\n"));
      const improved = applyFixes(analysis.content, fixes);

      if (!improved || improved.length < 100) {
        console.log("LLM returned empty/too short response, skipping");
        continue;
      }

      // Apply improvement
      const backup = analysis.content;
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would write improvement to ${targetFile} (${improved.length} chars)`);
      } else {
        writeFileSync(targetFile, improved);
      }
      console.log("Improvement applied, running benchmark...");

      // Measure AFTER improvement
      const afterMeasurement = runBenchmark(targetFile);
      if (!afterMeasurement) {
        if (!DRY_RUN) {
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
      const delta = afterScore - beforeScore;
      const deltaPct = beforeScore > 0 ? (delta / beforeScore) * 100 : (afterScore > 0 ? 100 : 0);
      const aboveNoise = Math.abs(deltaPct) >= (config?.noise_floor_pct || 5);
      const isImprovement = delta > 0;

      let decision;
      if (isImprovement && aboveNoise) {
        decision = { action: "keep", reason: `improved by ${deltaPct.toFixed(1)}% (${beforeScore} → ${afterScore})` };
      } else if (isImprovement) {
        decision = { action: "discard", reason: `improvement ${deltaPct.toFixed(1)}% below noise floor` };
      } else {
        decision = { action: "discard", reason: `no improvement (${deltaPct.toFixed(1)}%)` };
      }

      const result = {
        run: ++runCount,
        metric: "skill_quality",
        value: afterScore,
        status: "measured",
        description: `improved ${targetFile.split("/").pop()}`,
        timestamp: Date.now(),
      };
      results.push(result);
      if (!DRY_RUN) {
        appendJsonl(result);
      }

      console.log(`Decision: ${decision.action} — ${decision.reason}`);

      if (decision.action === "keep") {
        result.status = "keep";
        bestMetric = afterScore;
        bestRun = runCount;
        keptCount++;
        consecutiveDiscards = 0;
        runsSinceLastImprovement = 0;
        if (DRY_RUN) {
          console.log("[DRY RUN] Would KEEP improvement");
        } else {
          console.log("KEPT — improvement saved");
        }
      } else {
        result.status = "discard";
        discardedCount++;
        consecutiveDiscards++;
        runsSinceLastImprovement++;
        if (DRY_RUN) {
          console.log("[DRY RUN] Would DISCARD and revert");
        } else {
          writeFileSync(targetFile, backup);
          console.log("DISCARDED — reverted");
        }
      }

      if (!DRY_RUN) {
        appendJsonl(result);
      }
      decisions.push({ run: runCount, action: decision.action, reason: decision.reason, timestamp: new Date().toISOString() });
      if (!DRY_RUN) {
        appendJsonl({ type: "decision", run: runCount, action: decision.action, reason: decision.reason });
      }
    } catch (e) {
      console.error("Run error:", e.message);
      crashedCount++;
    }
  }

  // Summary
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   Autoresearch Complete                                ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Runs:       ${String(runCount).padEnd(42)}║`);
  console.log(`║  Kept:       ${String(keptCount).padEnd(42)}║`);
  console.log(`║  Discarded:  ${String(discardedCount).padEnd(42)}║`);
  console.log(`║  Crashed:    ${String(crashedCount).padEnd(42)}║`);
  console.log(`║  Best:       ${bestMetric !== null ? String(bestMetric).padEnd(42) : "N/A".padEnd(42)}║`);
  console.log(`║  Best Run:   ${bestRun !== null ? String(bestRun).padEnd(42) : "N/A".padEnd(42)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Save dashboard
  const dashboard = `# Autoresearch Dashboard

| Metric | Value |
|--------|-------|
| Runs | ${runCount} |
| Kept | ${keptCount} |
| Discarded | ${discardedCount} |
| Crashed | ${crashedCount} |
| Best Metric | ${bestMetric ?? "N/A"} |
| Best Run | ${bestRun ?? "N/A"} |
| Baseline | ${baselineMetric ?? "N/A"} |

## Recent Runs

${results
  .slice(-10)
  .map((r) => `| ${r.run} | ${r.value} | ${r.status} | ${r.description} |`)
  .join("\n")}
`;
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would save dashboard to: ${DASHBOARD_PATH}`);
  } else {
    writeFileSync(DASHBOARD_PATH, dashboard);
    console.log(`\nDashboard saved to: ${DASHBOARD_PATH}`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
