import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LoopState } from "./loop.js";
import { buildContinuationMessage } from "./loop.js";
import {
  dirtyUserPaths,
  ensureAutoresearchBranch,
  gitIsolationStatus,
  readContract,
  setMaxDiffLines,
  validateContractForStart,
} from "./policy.js";
import { ensureArtifactsLayout, parseStartBudgets, paths, readState } from "./state.js";
import type { ArConfig, ArState } from "./types.js";
import { dashboardRows, dashboardRowsFullscreen, footerText, statusText } from "./ui.js";

export interface StartPrereqResult {
  state: ArState;
  blockMsg?: string;
}

export function registerAutoresearchCommand(
  pi: ExtensionAPI,
  storeLoop: (s: LoopState | null) => void
): void {
  pi.registerCommand("autoresearch", {
    description:
      "Autoresearch: status | new <goal> | start [runs] [min] | ralph [runs] [min] | pause | resume | dashboard [--fullscreen] | validate | finalize [--archive] | quit",

    getArgumentCompletions: (prefix: string) => {
      const subs = [
        "status",
        "new",
        "start",
        "ralph",
        "pause",
        "resume",
        "dashboard",
        "validate",
        "finalize",
        "quit",
      ];
      return subs.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
    },

    handler: async (args: string, ctx) => {
      const [sub = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      ensureArtifactsLayout(ctx.cwd);
      const p = paths(ctx.cwd);

      switch (sub) {
        case "status":
        case "": {
          const state = readState(ctx.cwd);
          ctx.ui.notify(statusText(state), state.parseErrors.length > 0 ? "error" : "info");
          return;
        }

        case "pause": {
          fs.writeFileSync(p.sentinel, `paused: ${new Date().toISOString()}\n`);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify(
            "⏸️  Autoresearch gepauzeerd. /autoresearch resume om door te gaan.",
            "info"
          );
          return;
        }

        case "resume": {
          if (fs.existsSync(p.sentinel)) fs.unlinkSync(p.sentinel);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("▶️  Autoresearch hervat.", "info");
          return;
        }

        case "dashboard": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(
              [
                "Dashboard geblokkeerd; JSONL fouten:",
                ...state.parseErrors.map((e) => `- ${e}`),
              ].join("\n"),
              "error"
            );
            return;
          }
          if (!state.config) {
            ctx.ui.notify("Geen actieve sessie.", "warning");
            return;
          }
          const isFullscreen = rest.includes("--fullscreen") || rest.includes("-f");
          const rows = isFullscreen ? dashboardRowsFullscreen(state) : dashboardRows(state);
          ctx.ui.setWidget("autoresearch", rows);
          ctx.ui.notify(
            isFullscreen
              ? "📺 Fullscreen dashboard bijgewerkt — widget boven de editor."
              : "Dashboard bijgewerkt — widget boven de editor.",
            "info"
          );
          return;
        }

        case "validate": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(
              [
                "❌ .autoresearch/autoresearch.jsonl bevat fouten:",
                ...state.parseErrors.map((e) => `- ${e}`),
              ].join("\n"),
              "error"
            );
          } else if (!state.config) {
            ctx.ui.notify("Geen .autoresearch/autoresearch.jsonl gevonden.", "warning");
          } else {
            ctx.ui.notify(
              `✅ .autoresearch/autoresearch.jsonl valide — ${state.runCount} runs, ${state.decisions.length} decisions.`,
              "info"
            );
          }
          return;
        }

        case "new": {
          const goal = rest.join(" ").trim();
          if (!goal) {
            ctx.ui.notify("Gebruik: /autoresearch new <doel>", "warning");
            return;
          }
          if (fs.existsSync(p.context)) {
            const ok = await ctx.ui.confirm(
              "Overschrijven?",
              `.autoresearch/autoresearch.md bestaat al. Overschrijven voor: "${goal}"?`
            );
            if (!ok) return;
          }
          fs.mkdirSync(p.dir, { recursive: true });

          const isolation = ensureAutoresearchBranch(ctx.cwd, goal);
          if (!isolation.ok) {
            ctx.ui.notify(
              `⚠️ Git-isolatie niet automatisch ingesteld: ${isolation.reason}`,
              "warning"
            );
          }

          fs.writeFileSync(
            p.context,
            [
              `# Autoresearch: ${goal}`,
              "",
              "## Objective",
              goal,
              "",
              "## Metrics",
              "- **Primary**: run_seconds (s, lower is better)",
              "- **Secondary**: correctness pass/fail guardrail",
              "",
              "## How to Run",
              "`./.autoresearch/autoresearch.sh` — runs correctness checks and prints `METRIC name=value direction=lower|higher` lines.",
              "",
              "## Files in Scope",
              "- .",
              "",
              "## Off Limits",
              "- none",
              "",
              "## Constraints",
              "- Tests must pass before any keep decision.",
              "- One hypothesis per run.",
              "- Stop at configured budget, unsafe git state, corrupt state, or noisy benchmarks.",
              "",
              "## What's Been Tried",
              "- (baseline not measured yet)",
            ].join("\n")
          );
          const benchmark = p.benchmark;
          if (!fs.existsSync(benchmark)) {
            fs.writeFileSync(
              benchmark,
              [
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                "",
                'start_ms=$(node -e "process.stdout.write(String(Date.now()))")',
                "",
                "if [ -f package.json ] && command -v npm >/dev/null 2>&1; then",
                "  npm run validate",
                "elif [ -f scripts/validate.sh ] && command -v bash >/dev/null 2>&1; then",
                "  bash scripts/validate.sh",
                "elif [ -d tests ] && command -v python3 >/dev/null 2>&1; then",
                "  python3 -m unittest discover -s tests -p 'test_*.py'",
                "elif [ -d tests ] && command -v python >/dev/null 2>&1; then",
                "  python -m unittest discover -s tests -p 'test_*.py'",
                "fi",
                "",
                'end_ms=$(node -e "process.stdout.write(String(Date.now()))")',
                'run_seconds=$(node -e "const s=Number(process.argv[1]); const e=Number(process.argv[2]); process.stdout.write(((e-s)/1000).toFixed(6));" "$start_ms" "$end_ms")',
                'echo "METRIC run_seconds=${run_seconds} direction=lower"',
              ].join("\n"),
              { mode: 0o755 }
            );
          }
          if (!fs.existsSync(p.worklog)) {
            fs.writeFileSync(
              p.worklog,
              [
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
              ].join("\n")
            );
          }
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify(
            [
              `✅ Autoresearch sessie '${goal}' aangemaakt!`,
              isolation.ok && isolation.branch
                ? `🪵 Geïsoleerde branch actief: ${isolation.branch}`
                : "",
              "",
              "Volgende stappen:",
              "1. (Optioneel) verfijn .autoresearch/autoresearch.md — metric, scope en constraints",
              "2. Controleer .autoresearch/autoresearch.sh en pas benchmark/checks aan indien nodig",
              "3. /autoresearch start [runs] [min] — begin assisted loop",
              "   of: /autoresearch ralph [runs] [min] — begin Ralph mode",
            ]
              .filter(Boolean)
              .join("\n"),
            "info"
          );
          return;
        }

        case "finalize": {
          const state = readState(ctx.cwd);
          if (!state.config) {
            ctx.ui.notify("Geen actieve autoresearch sessie om te finalizen.", "warning");
            return;
          }
          const archiveRequested =
            rest.includes("--archive") || rest.includes("archive") || rest.includes("-a");

          const writeDashboard = await ctx.ui.confirm(
            "Dashboard schrijven?",
            "Wil je een einddashboard bewaren in .autoresearch/autoresearch-dashboard.md?"
          );
          if (writeDashboard) {
            const rows = dashboardRows(state);
            fs.writeFileSync(p.dashboard, rows.join("\n") + "\n", "utf-8");
          }

          const keepArtifacts = await ctx.ui.confirm(
            "Artefacten behouden?",
            "Wil je alle autoresearch artefacten bewaren in .autoresearch/? Kies 'Nee' voor cleanup."
          );
          if (!keepArtifacts) {
            if (archiveRequested) {
              if (!fs.existsSync(p.dir)) {
                ctx.ui.notify("Geen .autoresearch/ map om te archiveren.", "warning");
                return;
              }
              const confirmedArchive = await ctx.ui.confirm(
                "Archiveren bevestigen",
                "Archiveer .autoresearch/ naar experiments/archive/<timestamp>/ ?"
              );
              if (confirmedArchive) {
                const archivedTo = archiveArtifacts(ctx.cwd, p.dir);
                fs.mkdirSync(p.dir, { recursive: true });
                ctx.ui.notify(`📦 Gearchiveerd naar ${archivedTo}`, "info");
                return;
              }
            } else {
              const confirmed = await ctx.ui.confirm(
                "Cleanup bevestigen",
                "Verwijder .autoresearch/ volledig (contract, state, benchmark, worklog, dashboard, snapshot)?"
              );
              if (confirmed) {
                fs.rmSync(p.dir, { recursive: true, force: true });
                ctx.ui.notify("🧹 Autoresearch artefacten opgeruimd.", "info");
                return;
              }
            }
          }

          ctx.ui.notify(
            "✅ Finalize voltooid; artefacten blijven in .autoresearch/. Tip: /autoresearch finalize --archive",
            "info"
          );
          return;
        }

        case "quit": {
          storeLoop(null);
          pi.appendEntry("autoresearch-loop", null);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("🚪 Autoresearch loop gestopt. Gebruik /autoresearch start of /autoresearch ralph om opnieuw te beginnen.", "info");
          return;
        }

        case "start": {
          const prereq = ensureStartPrereqs(ctx.cwd, p);
          if (prereq.blockMsg) {
            ctx.ui.notify(prereq.blockMsg, "error");
            return;
          }
          const state = prereq.state;
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
          ctx.ui.notify(
            `🚀 Autoresearch gestart (assisted) — ${budgets.maxRuns} runs / ${budgets.maxMinutes} min.`,
            "info"
          );
          pi.sendUserMessage(
            buildContinuationMessage(
              loop,
              {
                runNumber: state.runCount + 1,
                runsUsed: 0,
                remainingRuns: budgets.maxRuns,
                elapsedMinutes: 0,
                remainingMinutes: budgets.maxMinutes,
                shouldContinue: true,
              },
              state
            ),
            { deliverAs: "followUp" }
          );
          return;
        }

        case "ralph": {
          const prereq = ensureStartPrereqs(ctx.cwd, p);
          if (prereq.blockMsg) {
            ctx.ui.notify(prereq.blockMsg, "error");
            return;
          }
          const state = prereq.state;
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
          ctx.ui.notify(
            `🐣 Ralph Wiggum mode — ${budgets.maxRuns} runs / ${budgets.maxMinutes} min. Simpelste hypotheses eerst.`,
            "info"
          );
          pi.sendUserMessage(
            buildContinuationMessage(
              loop,
              {
                runNumber: state.runCount + 1,
                runsUsed: 0,
                remainingRuns: budgets.maxRuns,
                remainingMinutes: budgets.maxMinutes,
                elapsedMinutes: 0,
                shouldContinue: true,
              },
              state
            ),
            { deliverAs: "followUp" }
          );
          return;
        }

        default:
          ctx.ui.notify(
            `Onbekend subcommando: '${sub}'\n\nGebruik:\n  status | new <goal> | start [runs] [min] | ralph [runs] [min] | pause | resume | dashboard [--fullscreen] | validate | finalize [--archive] | quit`,
            "warning"
          );
      }
    },
  });
}

export function ensureStartPrereqs(cwd: string, p: ReturnType<typeof paths>): StartPrereqResult {
  ensureArtifactsLayout(cwd);

  if (!fs.existsSync(p.context))
    return {
      state: readState(cwd),
      blockMsg: ".autoresearch/autoresearch.md niet gevonden. Gebruik eerst /autoresearch new <doel>.",
    };
  const benchmark = p.benchmark;
  if (!fs.existsSync(benchmark))
    return {
      state: readState(cwd),
      blockMsg: ".autoresearch/autoresearch.sh niet gevonden. Maak het aan voordat je start.",
    };
  if (fs.existsSync(p.sentinel))
    return {
      state: readState(cwd),
      blockMsg: "Loop is gepauzeerd. /autoresearch resume om door te gaan.",
    };

  const isolation = gitIsolationStatus(cwd);
  if (!isolation.inGitRepo) {
    return {
      state: readState(cwd),
      blockMsg:
        "Start geblokkeerd — geen git repository gevonden. Autoresearch vereist een aparte git branch/worktree.",
    };
  }
  if (!isolation.isolated) {
    const contextTitle = fs
      .readFileSync(p.context, "utf-8")
      .split("\n")
      .find((line) => line.startsWith("# "))
      ?.replace(/^#\s*Autoresearch:\s*/i, "")
      .trim();
    const branchResult = ensureAutoresearchBranch(cwd, contextTitle);
    if (!branchResult.ok) {
      const branch = isolation.branch || "(detached)";
      return {
        state: readState(cwd),
        blockMsg: `Start geblokkeerd — niet in geïsoleerde autoresearch branch/worktree. Huidige branch: ${branch}. ${branchResult.reason}`,
      };
    }
  }

  const contract = readContract(cwd);
  const contractErrors = validateContractForStart(contract);
  if (contractErrors.length > 0)
    return {
      state: readState(cwd),
      blockMsg: `Start geblokkeerd — contract niet compleet:\n${contractErrors.map((e) => `- ${e}`).join("\n")}`,
    };

  const benchmarkText = fs.readFileSync(benchmark, "utf-8");
  if (/not configured yet|<name>|<value>|TODO/i.test(benchmarkText)) {
    return {
      state: readState(cwd),
      blockMsg:
        "Start geblokkeerd — .autoresearch/autoresearch.sh bevat nog template/TODO tekst. Implementeer tests + benchmark eerst.",
    };
  }

  let state = readState(cwd);
  if (state.parseErrors.length > 0)
    return {
      state,
      blockMsg: `Start geblokkeerd — JSONL fouten:\n${state.parseErrors.join("\n")}`,
    };

  if (!state.config) {
    const config = inferConfigFromContext(fs.readFileSync(p.context, "utf-8"));
    if (!config) {
      return {
        state,
        blockMsg:
          "Start geblokkeerd — config ontbreekt en kon niet uit .autoresearch/autoresearch.md worden afgeleid. Vul `## Metrics` in als `- **Primary**: metric_name (unit, lower|higher is better)`.",
      };
    }
    appendConfigIfMissing(p.jsonl, config);
    state = readState(cwd);
    if (state.parseErrors.length > 0)
      return {
        state,
        blockMsg: `Start geblokkeerd — gegenereerde config is ongeldig:\n${state.parseErrors.join("\n")}`,
      };
  }

  const dirty = dirtyUserPaths(cwd);
  if (dirty.length > 0) {
    return {
      state,
      blockMsg: `Git working tree bevat niet-autoresearch wijzigingen. Commit/stash deze eerst:\n${dirty.map((file) => `- ${file}`).join("\n")}`,
    };
  }

  return { state };
}

function appendConfigIfMissing(jsonlPath: string, config: ArConfig): void {
  const line = `${JSON.stringify(config)}\n`;
  if (!fs.existsSync(jsonlPath)) {
    fs.writeFileSync(jsonlPath, line, "utf-8");
    return;
  }
  const current = fs.readFileSync(jsonlPath, "utf-8");
  if (current.trim()) return;
  fs.writeFileSync(jsonlPath, line, "utf-8");
}

export function archiveArtifacts(cwd: string, artifactsDir: string): string {
  const archiveRoot = path.join(cwd, "experiments", "archive");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(archiveRoot, stamp);
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(artifactsDir)) {
    const src = path.join(artifactsDir, entry);
    const dst = path.join(target, entry);
    fs.renameSync(src, dst);
  }
  return target;
}

function slugifyName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "autoresearch-session";
}

export function inferConfigFromContext(markdown: string): ArConfig | null {
  const metricLine = markdown.split("\n").find((line) => /\*\*Primary\*\*/i.test(line));
  if (!metricLine || metricLine.includes("<") || metricLine.includes(">")) return null;

  const metricMatch = /\*\*Primary\*\*:\s*([A-Za-z_][A-Za-z0-9_.:-]*)\s*(?:\(([^)]*)\))?/i.exec(
    metricLine
  );
  if (!metricMatch) return null;
  const metric = metricMatch[1];
  const details = `${metricMatch[2] ?? ""} ${metricLine}`.toLowerCase();
  const dir = /\b(higher|hoger|increase|larger|maximize|maximise)\b/.test(details)
    ? "higher"
    : /\b(lower|lager|decrease|smaller|minimize|minimise)\b/.test(details)
      ? "lower"
      : null;
  if (!dir) return null;

  const unit = (metricMatch[2] ?? "").split(",")[0]?.trim() ?? "";
  const title =
    markdown
      .split("\n")
      .find((line) => line.startsWith("# "))
      ?.replace(/^#\s*Autoresearch:\s*/i, "")
      .replace(/^#\s*/, "")
      .trim() ?? "autoresearch-session";

  return {
    type: "config",
    schema_version: 1,
    name: slugifyName(title),
    metric,
    direction: dir,
    unit: unit && !/lower|higher|lager|hoger/.test(unit.toLowerCase()) ? unit : "",
    created_at: new Date().toISOString(),
  };
}
