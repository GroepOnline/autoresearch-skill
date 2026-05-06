import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LoopState } from "./loop.js";
import { buildContinuationMessage, summarizeLoopStop } from "./loop.js";
import { setMaxDiffLines } from "./policy.js";
import { parseStartBudgets, paths, readState } from "./state.js";
import { dashboardRows, footerText, statusText } from "./ui.js";

export function registerAutoresearchCommand(pi: ExtensionAPI, storeLoop: (s: LoopState | null) => void): void {
  pi.registerCommand("autoresearch", {
    description: "Autoresearch: status | new <goal> | start [runs] [min] | ralph [runs] [min] | pause | resume | dashboard | validate",

    getArgumentCompletions: (prefix: string) => {
      const subs = ["status", "new", "start", "ralph", "pause", "resume", "dashboard", "validate"];
      return subs.filter(s => s.startsWith(prefix)).map(s => ({ value: s, label: s }));
    },

    handler: async (args: string, ctx) => {
      const [sub = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const p = paths(ctx.cwd);

      switch (sub) {
        // ── status ─────────────────────────────────────────────────────────────
        case "status":
        case "": {
          const state = readState(ctx.cwd);
          ctx.ui.notify(statusText(state), state.parseErrors.length > 0 ? "error" : "info");
          return;
        }

        // ── pause ──────────────────────────────────────────────────────────────
        case "pause": {
          fs.writeFileSync(p.sentinel, `paused: ${new Date().toISOString()}\n`);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("⏸️  Autoresearch gepauzeerd. /autoresearch resume om door te gaan.", "info");
          return;
        }

        // ── resume ─────────────────────────────────────────────────────────────
        case "resume": {
          if (fs.existsSync(p.sentinel)) fs.unlinkSync(p.sentinel);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("▶️  Autoresearch hervat.", "info");
          return;
        }

        // ── dashboard ──────────────────────────────────────────────────────────
        case "dashboard": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(["Dashboard geblokkeerd; JSONL fouten:", ...state.parseErrors.map(e => `- ${e}`)].join("\n"), "error");
            return;
          }
          if (!state.config) {
            ctx.ui.notify("Geen actieve sessie.", "warning");
            return;
          }
          ctx.ui.setWidget("autoresearch", dashboardRows(state));
          ctx.ui.notify("Dashboard bijgewerkt — widget boven de editor.", "info");
          return;
        }

        // ── validate ───────────────────────────────────────────────────────────
        case "validate": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(["❌ autoresearch.jsonl bevat fouten:", ...state.parseErrors.map(e => `- ${e}`)].join("\n"), "error");
          } else if (!state.config) {
            ctx.ui.notify("Geen autoresearch.jsonl gevonden.", "warning");
          } else {
            ctx.ui.notify(`✅ autoresearch.jsonl valide — ${state.runCount} runs, ${state.decisions.length} decisions.`, "info");
          }
          return;
        }

        // ── new ────────────────────────────────────────────────────────────────
        case "new": {
          const goal = rest.join(" ").trim();
          if (!goal) {
            ctx.ui.notify("Gebruik: /autoresearch new <doel>", "warning");
            return;
          }
          if (fs.existsSync(p.context)) {
            const ok = await ctx.ui.confirm("Overschrijven?", `autoresearch.md bestaat al. Overschrijven voor: "${goal}"?`);
            if (!ok) return;
          }
          fs.mkdirSync(path.join(ctx.cwd, "experiments"), { recursive: true });
          fs.writeFileSync(p.context, [
            `# Autoresearch: ${goal}`,
            "",
            "## Objective",
            goal,
            "",
            "## Metrics",
            "- **Primary**: <metric_name> (<unit>, lower/higher is better)",
            "- **Secondary**: optional correctness, size, memory, or latency guardrails",
            "",
            "## How to Run",
            "`./autoresearch.sh` — runs correctness checks and prints `METRIC name=value direction=lower|higher` lines.",
            "",
            "## Files in Scope",
            "<Every file the agent may change>",
            "",
            "## Off Limits",
            "<Files, APIs, or behaviors that must not change>",
            "",
            "## Constraints",
            "- Tests must pass before any keep decision.",
            "- One hypothesis per run.",
            "- Stop at configured budget, unsafe git state, corrupt state, or noisy benchmarks.",
            "",
            "## What's Been Tried",
            "- (baseline not measured yet)",
          ].join("\n"));
          const benchmark = path.join(ctx.cwd, "autoresearch.sh");
          if (!fs.existsSync(benchmark)) {
            fs.writeFileSync(benchmark, [
              "#!/usr/bin/env bash",
              "set -euo pipefail",
              "",
              "# Run correctness checks and benchmark, then print METRIC lines:",
              "#   METRIC latency_ms=12.4 direction=lower",
              "echo 'autoresearch.sh is not configured yet — edit it before starting.' >&2",
              "exit 2",
            ].join("\n"), { mode: 0o755 });
          }
          if (!fs.existsSync(p.worklog)) {
            fs.writeFileSync(p.worklog, [
              `# Autoresearch Worklog: ${goal}`,
              `Started: ${new Date().toISOString().slice(0, 16)}`,
              "",
              "## Key Insights",
              "- (record lessons after each experiment)",
              "",
              "## Next Ideas",
              "- (add candidate hypotheses here)",
              "",
              "---",
            ].join("\n"));
          }
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify([
            `✅ Autoresearch sessie '${goal}' aangemaakt!`,
            "",
            "Volgende stappen:",
            "1. Bewerk autoresearch.md — metrics, scope, constraints",
            "2. Bewerk autoresearch.sh — implementeer tests + benchmark",
            "3. /autoresearch start [runs] [min] — begin assisted loop",
            "   of: /autoresearch ralph [runs] [min] — begin Ralph mode",
          ].join("\n"), "info");
          return;
        }

        // ── start ──────────────────────────────────────────────────────────────
        case "start": {
          const state = readState(ctx.cwd);
          const blockMsg = checkStartPrereqs(state, p, ctx.cwd);
          if (blockMsg) { ctx.ui.notify(blockMsg, "error"); return; }

          const budgets = parseStartBudgets(rest);
          const loop: LoopState = {
            mode: "assisted",
            maxRuns: budgets.maxRuns,
            maxMinutes: budgets.maxMinutes,
            startedAt: Date.now(),
            runsAtStart: state.runCount,
            maxConsecutiveDiscards: 5,
            consecutiveDiscards: 0,
            maxRunsWithoutImprovement: 10,
            runsSinceLastImprovement: 0,
            trackedRuns: 0,
          };
          storeLoop(loop);
          pi.appendEntry("autoresearch-loop", loop);
          setMaxDiffLines(50);
          ctx.ui.notify(`🚀 Autoresearch gestart (assisted) — ${budgets.maxRuns} runs / ${budgets.maxMinutes} min.`, "info");
          pi.sendUserMessage(buildContinuationMessage(loop, { runNumber: state.runCount + 1, runsUsed: 0, remainingRuns: budgets.maxRuns, elapsedMinutes: 0, remainingMinutes: budgets.maxMinutes, shouldContinue: true }, state), { deliverAs: "followUp" });
          return;
        }

        // ── ralph ──────────────────────────────────────────────────────────────
        case "ralph": {
          const state = readState(ctx.cwd);
          const blockMsg = checkStartPrereqs(state, p, ctx.cwd);
          if (blockMsg) { ctx.ui.notify(blockMsg, "error"); return; }

          const budgets = parseStartBudgets(rest.length ? rest : ["3", "20"]);
          const loop: LoopState = {
            mode: "ralph",
            maxRuns: budgets.maxRuns,
            maxMinutes: budgets.maxMinutes,
            startedAt: Date.now(),
            runsAtStart: state.runCount,
            maxConsecutiveDiscards: 5,
            consecutiveDiscards: 0,
            maxRunsWithoutImprovement: 10,
            runsSinceLastImprovement: 0,
            trackedRuns: 0,
          };
          storeLoop(loop);
          pi.appendEntry("autoresearch-loop", loop);
          setMaxDiffLines(10);
          ctx.ui.notify(`🐣 Ralph Wiggum mode — ${budgets.maxRuns} runs / ${budgets.maxMinutes} min. Simpelste hypotheses eerst.`, "info");
          pi.sendUserMessage(buildContinuationMessage(loop, { runNumber: state.runCount + 1, runsUsed: 0, remainingRuns: budgets.maxRuns, remainingMinutes: budgets.maxMinutes, elapsedMinutes: 0, shouldContinue: true }, state), { deliverAs: "followUp" });
          return;
        }

        default:
          ctx.ui.notify(
            `Onbekend subcommando: '${sub}'\n\nGebruik:\n  status | new <goal> | start [runs] [min] | ralph [runs] [min] | pause | resume | dashboard | validate`,
            "warning",
          );
      }
    },
  });
}

function checkStartPrereqs(state: ReturnType<typeof readState>, p: ReturnType<typeof paths>, cwd: string): string | null {
  const { existsSync } = fs;
  const pathJoin = path.join;
  if (state.parseErrors.length > 0) return `Start geblokkeerd — JSONL fouten:\n${state.parseErrors.join("\n")}`;
  if (!existsSync(p.context)) return "autoresearch.md niet gevonden. Gebruik eerst /autoresearch new <doel>.";
  if (!existsSync(pathJoin(cwd, "autoresearch.sh"))) return "autoresearch.sh niet gevonden. Maak het aan voordat je start.";
  if (existsSync(p.sentinel)) return "Loop is gepauzeerd. /autoresearch resume om door te gaan.";
  // Check git working tree is clean (skip if not a git repo)
  try {
    const status = execSync("git status --porcelain", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (status) return "Git working tree is dirty. Commit of stash wijzigingen voordat je /autoresearch start.";
  } catch { /* not a git repo — skip check */ }
  return null;
}
