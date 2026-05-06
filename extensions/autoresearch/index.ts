/**
 * Autoresearch Pi Extension
 *
 * Native Pi TUI integration for bounded autoresearch sessions:
 *  - /autoresearch [status|pause|resume|dashboard|new|start]
 *  - Footer status from autoresearch.jsonl
 *  - before_agent_start: injects bounded loop context when autoresearch.md exists
 *  - session_before_compact: preserves valid loop state in compaction summaries
 *  - session_start: restores footer/state on reload/resume
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { registerAutoresearchCommand } from "./commands.js";
import { buildContextInjection, delta, direction, fmt, metricName, metricUnit, paths, readState } from "./state.js";
import { footerText } from "./ui.js";

export default function autoresearchExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));

    if (state.hasIdeas) {
      const lines = fs.readFileSync(paths(ctx.cwd).ideas, "utf-8").split("\n");
      const count = lines.filter(line => line.startsWith("- ")).length;
      if (count > 0) ctx.ui.notify(`💡 autoresearch.ideas.md heeft ${count} ideeën`, "info");
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    const injection = buildContextInjection(ctx.cwd, state);
    if (!injection) return;

    ctx.ui.setStatus("autoresearch", footerText(state));

    return {
      message: {
        customType: "autoresearch-context",
        content: injection,
        display: false,
      },
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const state = readState(ctx.cwd);
    if (!state.config || state.parseErrors.length > 0) return;

    const { preparation } = event;
    const config = state.config;
    const arSummary = [
      `## Autoresearch Loop — Context Preserved`,
      `Name: ${config.name}`,
      `Metric: ${metricName(config)} (${direction(config)})`,
      `Runs: ${state.runCount} | Kept: ${state.keptCount} | Discarded: ${state.discardedCount} | Crashed: ${state.crashedCount}`,
      state.baselineMetric !== null ? `Baseline: ${fmt(state.baselineMetric, metricUnit(config))}` : "",
      state.bestMetric !== null && state.bestRun !== null ? `Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}` : "",
      "",
      `State files: autoresearch.jsonl, autoresearch.md, experiments/worklog.md`,
      `Rule: continue bounded experiments; stop at configured budget, safety issues, corrupt state, or noisy/failed measurements.`,
      `Resume: read autoresearch.jsonl + worklog.md, continue from run ${state.runCount + 1}`,
    ].filter(Boolean).join("\n");

    return {
      compaction: {
        summary: `${arSummary}\n\n---\n\n[See autoresearch.jsonl for full experiment history]`,
        firstKeptEntryId: preparation.firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
      },
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("autoresearch", "");
  });

  registerAutoresearchCommand(pi);
}
