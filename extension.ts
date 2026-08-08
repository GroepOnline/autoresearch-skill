/**
 * Autoresearch Pi Extension
 *
 * Voegt native pi TUI-integratie toe aan de autoresearch loop:
 *  - /autoresearch [status|pause|resume|dashboard|new|start]
 *  - Footer status: "🔬 Run 42 | Best: 3.2s (-24%)"
 *  - before_agent_start: injecteert loop context als autoresearch.md aanwezig is
 *  - session_before_compact: bewaard loop state in compaction summary
 *  - session_start: herstelt footer/state bij reload/resume
 *
 * Installatie:
 *   ln -s ~/projects/autoresearch-skill/extension.ts ~/.pi/agent/extensions/autoresearch.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArConfig {
  type: "config";
  name: string;
  metricName: string;
  metricUnit: string;
  bestDirection: "lower" | "higher";
  segment?: number;
}

interface ArResult {
  run: number;
  commit: string;
  metric: number;
  metrics: Record<string, number>;
  status: "keep" | "discard" | "crash";
  description: string;
  timestamp: number;
  segment: number;
}

interface ArState {
  config: ArConfig | null;
  results: ArResult[];
  runCount: number;
  keptCount: number;
  discardedCount: number;
  crashedCount: number;
  bestMetric: number | null;
  bestRun: number | null;
  baselineMetric: number | null;
  currentSegment: number;
  isPaused: boolean;
  hasIdeas: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function paths(cwd: string) {
  return {
    jsonl:     path.join(cwd, "autoresearch.jsonl"),
    context:   path.join(cwd, "autoresearch.md"),
    sentinel:  path.join(cwd, ".autoresearch-off"),
    dashboard: path.join(cwd, "autoresearch-dashboard.md"),
    worklog:   path.join(cwd, "experiments", "worklog.md"),
    ideas:     path.join(cwd, "autoresearch.ideas.md"),
  };
}

function readState(cwd: string): ArState {
  const p = paths(cwd);
  const blank: ArState = {
    config: null, results: [], runCount: 0,
    keptCount: 0, discardedCount: 0, crashedCount: 0,
    bestMetric: null, bestRun: null, baselineMetric: null,
    currentSegment: 0, isPaused: fs.existsSync(p.sentinel),
    hasIdeas: fs.existsSync(p.ideas),
  };

  if (!fs.existsSync(p.jsonl)) return blank;

  let config: ArConfig | null = null;
  const results: ArResult[] = [];
  let segment = 0;
  let baselineSet = false;
  let baselineMetric: number | null = null;

  for (const raw of fs.readFileSync(p.jsonl, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "config") {
        config = e as ArConfig;
        segment = e.segment ?? segment;
        baselineSet = false;
        baselineMetric = null;
      } else if (e.run !== undefined) {
        const r = e as ArResult;
        results.push(r);
        if (!baselineSet && r.status !== "crash") {
          baselineMetric = r.metric;
          baselineSet = true;
        }
      }
    } catch { /* skip malformed */ }
  }

  const kept      = results.filter(r => r.status === "keep");
  const discarded = results.filter(r => r.status === "discard");
  const crashed   = results.filter(r => r.status === "crash");

  // Best metric from kept results
  let bestMetric: number | null = null;
  let bestRun: number | null = null;
  if (config) {
    for (const r of kept) {
      if (
        bestMetric === null ||
        (config.bestDirection === "lower" ? r.metric < bestMetric : r.metric > bestMetric)
      ) {
        bestMetric = r.metric;
        bestRun = r.run;
      }
    }
  }

  return {
    config,
    results,
    runCount: results.length,
    keptCount: kept.length,
    discardedCount: discarded.length,
    crashedCount: crashed.length,
    bestMetric,
    bestRun,
    baselineMetric,
    currentSegment: segment,
    isPaused: fs.existsSync(p.sentinel),
    hasIdeas: fs.existsSync(p.ideas),
  };
}

function fmt(value: number, unit: string): string {
  return unit ? `${value}${unit}` : String(value);
}

function delta(current: number, baseline: number): string {
  if (!baseline) return "";
  const d = ((current - baseline) / baseline) * 100;
  return d >= 0 ? `(+${d.toFixed(1)}%)` : `(${d.toFixed(1)}%)`;
}

function footerText(state: ArState): string {
  if (!state.config) return "";
  const { config, runCount, bestMetric, bestRun, baselineMetric, isPaused } = state;
  const last = state.results.at(-1);
  const icon = isPaused ? "⏸" : last?.status === "keep" ? "✅" : last?.status === "crash" ? "💥" : "🔬";
  let s = `${icon} AR:${config.name} | runs:${runCount}`;
  if (bestMetric !== null && baselineMetric !== null) {
    s += ` | best:${fmt(bestMetric, config.metricUnit)} ${delta(bestMetric, baselineMetric)}`;
  }
  if (isPaused) s += " [paused]";
  return s;
}

function buildContextInjection(cwd: string, state: ArState): string | null {
  const p = paths(cwd);
  if (!fs.existsSync(p.context) || fs.existsSync(p.sentinel)) return null;

  let md = fs.readFileSync(p.context, "utf-8");

  if (state.config && state.runCount > 0) {
    const { config, runCount, keptCount, discardedCount, crashedCount, bestMetric, bestRun, baselineMetric } = state;
    const last = state.results.at(-1);
    md += `\n\n---\n## Autoresearch Loop — Live State\n`;
    md += `- Run: **${runCount}** | ✅ ${keptCount} | ❌ ${discardedCount} | 💥 ${crashedCount}\n`;
    if (baselineMetric !== null)
      md += `- Baseline ${config.metricName}: ${fmt(baselineMetric, config.metricUnit)}\n`;
    if (bestMetric !== null && bestRun !== null)
      md += `- Best ${config.metricName}: ${fmt(bestMetric, config.metricUnit)} (#${bestRun}) ${delta(bestMetric, baselineMetric ?? 0)}\n`;
    if (last)
      md += `- Last run #${last.run}: ${last.status} — ${last.description}\n`;
    md += `\n**LOOP FOREVER. Primary metric is king. NEVER STOP.**\n`;
  }

  return md;
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function autoresearchExtension(pi: ExtensionAPI) {

  // ── Session start: herstel footer ──────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));

    if (state.hasIdeas) {
      const lines = fs.readFileSync(paths(ctx.cwd).ideas, "utf-8").split("\n");
      const count = lines.filter(l => l.startsWith("- ")).length;
      if (count > 0)
        ctx.ui.notify(`💡 autoresearch.ideas.md heeft ${count} ideeën`, "info");
    }
  });

  // ── before_agent_start: injecteer loop context ─────────────────────────────
  pi.on("before_agent_start", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    const injection = buildContextInjection(ctx.cwd, state);
    if (!injection) return;

    // Update footer ook
    ctx.ui.setStatus("autoresearch", footerText(state));

    return {
      message: {
        customType: "autoresearch-context",
        content: injection,
        display: false, // stil injecteren, niet zichtbaar in TUI
      },
    };
  });

  // ── agent_end: update footer na elke run ───────────────────────────────────
  pi.on("agent_end", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));
  });

  // ── session_before_compact: bewaar loop state in summary ───────────────────
  pi.on("session_before_compact", async (event, ctx) => {
    const state = readState(ctx.cwd);
    if (!state.config) return; // geen actieve loop, laat default compaction doen

    const { preparation } = event;

    // Bouw een autoresearch-bewust compaction summary
    const arSummary = [
      `## Autoresearch Loop — Context Preserved`,
      `Name: ${state.config.name}`,
      `Metric: ${state.config.metricName} (${state.config.bestDirection})`,
      `Runs: ${state.runCount} | Kept: ${state.keptCount} | Discarded: ${state.discardedCount} | Crashed: ${state.crashedCount}`,
      state.baselineMetric !== null ? `Baseline: ${fmt(state.baselineMetric, state.config.metricUnit)}` : "",
      state.bestMetric !== null && state.bestRun !== null
        ? `Best: ${fmt(state.bestMetric, state.config.metricUnit)} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}`
        : "",
      ``,
      `State files: autoresearch.jsonl, autoresearch.md, experiments/worklog.md`,
      `Loop rule: LOOP FOREVER. Primary metric is king. NEVER STOP.`,
      `Resume: read autoresearch.jsonl + worklog.md, continue from run ${state.runCount + 1}`,
    ].filter(Boolean).join("\n");

    // We injecteren het als extra context in de compaction — NIET blokkeren
    // custom-compaction.ts doet de echte samenvatting, wij voegen AR state toe
    // door een append aan de compaction message te doen via systemPrompt
    return {
      compaction: {
        summary: `${arSummary}\n\n---\n\n[See autoresearch.jsonl for full experiment history]`,
        firstKeptEntryId: preparation.firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
      },
    };
  });

  // ── session_shutdown: clear footer ────────────────────────────────────────
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("autoresearch", "");
  });

  // ── /autoresearch command ──────────────────────────────────────────────────
  pi.registerCommand("autoresearch", {
    description: "Autoresearch loop control: status | pause | resume | dashboard | new <goal> | start",

    getArgumentCompletions: (prefix: string) => {
      const subs = ["status", "pause", "resume", "dashboard", "new", "start"];
      return subs
        .filter(s => s.startsWith(prefix))
        .map(s => ({ value: s, label: s }));
    },

    handler: async (args: string, ctx) => {
      const [sub, ...rest] = (args ?? "").trim().split(/\s+/);
      const p = paths(ctx.cwd);

      switch (sub) {

        // ── status ──────────────────────────────────────────────────────────
        case "status":
        case "": {
          const state = readState(ctx.cwd);
          if (!state.config) {
            ctx.ui.notify("Geen actieve autoresearch sessie.\n\nStart met: /autoresearch new <doel>", "info");
            return;
          }
          const { config, runCount, keptCount, discardedCount, crashedCount, bestMetric, bestRun, baselineMetric, isPaused } = state;
          const last = state.results.at(-1);
          ctx.ui.notify([
            `🔬 Autoresearch: ${config.name}`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `Metric: ${config.metricName} (${config.bestDirection} = beter)`,
            `Runs: ${runCount} | ✅ ${keptCount} | ❌ ${discardedCount} | 💥 ${crashedCount}`,
            baselineMetric !== null ? `Baseline: ${fmt(baselineMetric, config.metricUnit)}` : "",
            bestMetric !== null && bestRun !== null
              ? `Best: ${fmt(bestMetric, config.metricUnit)} (#${bestRun}) ${delta(bestMetric, baselineMetric ?? 0)}`
              : "Best: geen resultaten nog",
            last ? `Laatste: run #${last.run} → ${last.status} — ${last.description}` : "",
            isPaused ? "⏸️  GEPAUZEERD — gebruik /autoresearch resume" : "▶️  ACTIEF",
            state.hasIdeas ? "💡 autoresearch.ideas.md aanwezig" : "",
          ].filter(Boolean).join("\n"), "info");
          return;
        }

        // ── pause ───────────────────────────────────────────────────────────
        case "pause": {
          fs.writeFileSync(p.sentinel, `paused: ${new Date().toISOString()}\n`);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("⏸️  Autoresearch loop gepauzeerd.\nGebruik /autoresearch resume om door te gaan.", "info");
          return;
        }

        // ── resume ──────────────────────────────────────────────────────────
        case "resume": {
          if (fs.existsSync(p.sentinel)) fs.unlinkSync(p.sentinel);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("▶️  Autoresearch loop hervat.", "info");
          return;
        }

        // ── dashboard ───────────────────────────────────────────────────────
        case "dashboard": {
          const state = readState(ctx.cwd);
          if (!state.config) {
            ctx.ui.notify("Geen actieve sessie.", "warning");
            return;
          }
          const { config, results, runCount, keptCount, discardedCount, crashedCount, baselineMetric } = state;

          // Toon dashboard als widget boven editor
          const rows = [`🔬 ${config.name} | ${runCount} runs | ✅${keptCount} ❌${discardedCount} 💥${crashedCount}`];
          if (baselineMetric !== null)
            rows.push(`Baseline: ${fmt(baselineMetric, config.metricUnit)}`);
          if (state.bestMetric !== null && state.bestRun !== null)
            rows.push(`Best: ${fmt(state.bestMetric, config.metricUnit)} (#${state.bestRun}) ${delta(state.bestMetric, baselineMetric ?? 0)}`);
          rows.push("─".repeat(60));
          rows.push(`# │ ${config.metricName.padEnd(12)} │ status   │ beschrijving`);
          rows.push("─".repeat(60));

          for (const r of results.slice(-12)) {
            const icon = r.status === "keep" ? "✅" : r.status === "discard" ? "❌" : "💥";
            const d = baselineMetric !== null ? delta(r.metric, baselineMetric) : "";
            rows.push(
              `${String(r.run).padStart(3)} │ ${fmt(r.metric, config.metricUnit).padEnd(12)} │ ${icon} ${r.status.padEnd(7)} │ ${r.description.slice(0, 28)} ${d}`
            );
          }

          ctx.ui.setWidget("autoresearch", rows);
          ctx.ui.notify("Dashboard bijgewerkt — zie widget boven de editor.", "info");
          return;
        }

        // ── new <doel> ───────────────────────────────────────────────────────
        case "new": {
          const doel = rest.join(" ").trim();
          if (!doel) {
            ctx.ui.notify("Gebruik: /autoresearch new <doel>\nBijv: /autoresearch new optimize-lexer-performance", "warning");
            return;
          }

          if (fs.existsSync(p.context)) {
            const ok = await ctx.ui.confirm("Overschrijven?", `autoresearch.md bestaat al. Overschrijven voor nieuw doel: "${doel}"?`);
            if (!ok) return;
          }

          // Maak experimenten map
          fs.mkdirSync(path.join(ctx.cwd, "experiments"), { recursive: true });

          // Scaffold autoresearch.md
          fs.writeFileSync(p.context, [
            `# Autoresearch: ${doel}`,
            ``,
            `## Objective`,
            `${doel}`,
            ``,
            `## Metrics`,
            `- **Primary**: <metric_name> (<unit>, lower/higher is better)`,
            `- **Secondary**: (optioneel)`,
            ``,
            `## How to Run`,
            `\`./autoresearch.sh\` — outputs \`METRIC name=number\` regels.`,
            ``,
            `## Files in Scope`,
            `<Elk bestand dat de agent mag wijzigen>`,
            ``,
            `## Off Limits`,
            `<Wat NIET aangeraakt mag worden>`,
            ``,
            `## Constraints`,
            `<Harde regels: tests must pass, no new deps, etc.>`,
            ``,
            `## What's Been Tried`,
            `- (nog niets — dit is de baseline)`,
          ].join("\n"));

          // Scaffold autoresearch.sh
          if (!fs.existsSync(path.join(ctx.cwd, "autoresearch.sh"))) {
            fs.writeFileSync(path.join(ctx.cwd, "autoresearch.sh"), [
              `#!/usr/bin/env bash`,
              `set -euo pipefail`,
              ``,
              `# Run benchmark and output METRIC lines`,
              `# Example:`,
              `# time_ms=$(...)`,
              `# echo "METRIC latency_ms=$time_ms"`,
              ``,
              `echo "METRIC <name>=<value>"`,
            ].join("\n"), { mode: 0o755 });
          }

          // Maak worklog
          if (!fs.existsSync(p.worklog)) {
            fs.writeFileSync(p.worklog, [
              `# Autoresearch Worklog: ${doel}`,
              `Started: ${new Date().toISOString().slice(0, 16)}`,
              ``,
              `## Key Insights`,
              `- (worden hier bijgehouden naarmate experiments vorderen)`,
              ``,
              `## Next Ideas`,
              `- (toevoegen naarmate ideeën opkomen)`,
              ``,
              `---`,
            ].join("\n"));
          }

          ctx.ui.notify([
            `✅ Autoresearch sessie '${doel}' aangemaakt!`,
            ``,
            `Volgende stappen:`,
            `1. Edit autoresearch.md — vul metrics, files, constraints in`,
            `2. Edit autoresearch.sh — implementeer de benchmark`,
            `3. /autoresearch start — begin de loop`,
          ].join("\n"), "info");

          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          return;
        }

        // ── start ────────────────────────────────────────────────────────────
        case "start": {
          const p2 = paths(ctx.cwd);
          if (!fs.existsSync(p2.context)) {
            ctx.ui.notify("autoresearch.md niet gevonden. Gebruik eerst /autoresearch new <doel>.", "error");
            return;
          }
          if (!fs.existsSync(path.join(ctx.cwd, "autoresearch.sh"))) {
            ctx.ui.notify("autoresearch.sh niet gevonden. Maak het aan voordat je start.", "error");
            return;
          }
          if (fs.existsSync(p2.sentinel)) {
            ctx.ui.notify("Loop is gepauzeerd. Gebruik /autoresearch resume eerst.", "warning");
            return;
          }

          ctx.ui.notify("🚀 Autoresearch loop gestart! Agent begint experiments te runnen...", "info");

          // Stuur de agent de loop instructie als follow-up
          pi.sendUserMessage(
            `Start de autoresearch loop. Lees autoresearch.md, autoresearch.jsonl en experiments/worklog.md voor context. Run ./autoresearch.sh als benchmark. LOOP FOREVER — stop niet tenzij geïnterrumpeerd.`,
            { deliverAs: "followUp" }
          );
          return;
        }

        default:
          ctx.ui.notify(
            `Onbekend subcommando: '${sub}'\n\nGebruik:\n  /autoresearch status\n  /autoresearch pause\n  /autoresearch resume\n  /autoresearch dashboard\n  /autoresearch new <doel>\n  /autoresearch start`,
            "warning"
          );
      }
    },
  });
}
