import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseStartBudgets, paths, readState } from "./state.js";
import { dashboardRows, footerText, statusText } from "./ui.js";

export function registerAutoresearchCommand(pi: ExtensionAPI): void {
  pi.registerCommand("autoresearch", {
    description: "Autoresearch loop control: status | pause | resume | dashboard | new <goal> | start [max_runs] [max_minutes]",

    getArgumentCompletions: (prefix: string) => {
      const subs = ["status", "pause", "resume", "dashboard", "new", "start"];
      return subs.filter(sub => sub.startsWith(prefix)).map(sub => ({ value: sub, label: sub }));
    },

    handler: async (args: string, ctx) => {
      const [sub = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const p = paths(ctx.cwd);

      switch (sub) {
        case "status":
        case "": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(statusText(state), "error");
            return;
          }
          if (!state.config) {
            ctx.ui.notify(statusText(state), "info");
            return;
          }
          ctx.ui.notify(statusText(state), "info");
          return;
        }

        case "pause": {
          fs.writeFileSync(p.sentinel, `paused: ${new Date().toISOString()}\n`);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("⏸️  Autoresearch loop gepauzeerd.\nGebruik /autoresearch resume om door te gaan.", "info");
          return;
        }

        case "resume": {
          if (fs.existsSync(p.sentinel)) fs.unlinkSync(p.sentinel);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("▶️  Autoresearch loop hervat.", "info");
          return;
        }

        case "dashboard": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(["Kan dashboard niet tonen; JSONL fouten:", ...state.parseErrors.map(error => `- ${error}`)].join("\n"), "error");
            return;
          }
          if (!state.config) {
            ctx.ui.notify("Geen actieve sessie.", "warning");
            return;
          }

          ctx.ui.setWidget("autoresearch", dashboardRows(state));
          ctx.ui.notify("Dashboard bijgewerkt — zie widget boven de editor.", "info");
          return;
        }

        case "new": {
          const goal = rest.join(" ").trim();
          if (!goal) {
            ctx.ui.notify("Gebruik: /autoresearch new <doel>\nBijv: /autoresearch new optimize-parser-latency", "warning");
            return;
          }

          if (fs.existsSync(p.context)) {
            const ok = await ctx.ui.confirm("Overschrijven?", `autoresearch.md bestaat al. Overschrijven voor nieuw doel: "${goal}"?`);
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
              "# TODO: run your real correctness checks and benchmark here.",
              "# The benchmark must print at least one line like:",
              "#   METRIC latency_ms=12.4 direction=lower",
              "echo 'autoresearch.sh is not configured yet; edit it before /autoresearch start.' >&2",
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

          ctx.ui.notify([
            `✅ Autoresearch sessie '${goal}' aangemaakt!`,
            "",
            "Volgende stappen:",
            "1. Edit autoresearch.md — vul metrics, scope en constraints in",
            "2. Edit autoresearch.sh — implementeer echte tests/benchmark",
            "3. /autoresearch start [max_runs] [max_minutes] — begin bounded loop",
          ].join("\n"), "info");

          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          return;
        }

        case "start": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(["Start geblokkeerd; JSONL fouten:", ...state.parseErrors.map(error => `- ${error}`)].join("\n"), "error");
            return;
          }
          if (!fs.existsSync(p.context)) {
            ctx.ui.notify("autoresearch.md niet gevonden. Gebruik eerst /autoresearch new <doel>.", "error");
            return;
          }
          if (!fs.existsSync(path.join(ctx.cwd, "autoresearch.sh"))) {
            ctx.ui.notify("autoresearch.sh niet gevonden. Maak het aan voordat je start.", "error");
            return;
          }
          if (fs.existsSync(p.sentinel)) {
            ctx.ui.notify("Loop is gepauzeerd. Gebruik /autoresearch resume eerst.", "warning");
            return;
          }

          const budgets = parseStartBudgets(rest);
          ctx.ui.notify(`🚀 Autoresearch loop gestart met budget: ${budgets.maxRuns} runs / ${budgets.maxMinutes} min.`, "info");
          pi.sendUserMessage([
            "Start de bounded autoresearch loop.",
            "Lees autoresearch.md, autoresearch.jsonl en experiments/worklog.md voor context.",
            "Run ./autoresearch.sh als benchmark en parse METRIC-regels.",
            `Budget: maximaal ${budgets.maxRuns} runs of ${budgets.maxMinutes} minuten.`,
            "Test één hypothese per run, vergelijk tegen de huidige best, leg elke beslissing vast, en stop bij budget/safety/noise/correctness failures.",
          ].join(" "), { deliverAs: "followUp" });
          return;
        }

        default:
          ctx.ui.notify(
            `Onbekend subcommando: '${sub}'\n\nGebruik:\n  /autoresearch status\n  /autoresearch pause\n  /autoresearch resume\n  /autoresearch dashboard\n  /autoresearch new <doel>\n  /autoresearch start [max_runs] [max_minutes]`,
            "warning",
          );
      }
    },
  });
}
