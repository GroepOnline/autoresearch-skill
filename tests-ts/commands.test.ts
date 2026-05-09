import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerAutoresearchCommand } from "../extensions/autoresearch/commands.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "pi-autoresearch-commands-test-"));
}

function writePrereqs(cwd: string): void {
  writeFileSync(join(cwd, "autoresearch.md"), "# Autoresearch\n\n## Files in Scope\n- src/app.ts\n\n## Off Limits\n- .env\n", "utf-8");
  writeFileSync(join(cwd, "autoresearch.sh"), "#!/usr/bin/env bash\necho ok\n", { mode: 0o755 });
}

test("start command uses config thresholds in loop state", async () => {
  const cwd = tempProject();
  writePrereqs(cwd);
  writeFileSync(join(cwd, "autoresearch.jsonl"), [
    JSON.stringify({
      type: "config",
      schema_version: 1,
      name: "thresholds",
      metric: "latency_ms",
      direction: "lower",
      created_at: "2026-05-09T00:00:00Z",
      max_consecutive_discards: 4,
      max_runs_without_improvement: 8,
      max_diff_lines_assisted: 33,
      max_diff_lines_ralph: 7,
    }),
  ].join("\n") + "\n", "utf-8");

  let storedLoop: any = null;
  let sentMessage: string | null = null;
  let registered: any = null;

  const pi: any = {
    registerCommand(_name: string, spec: any) {
      registered = spec;
    },
    appendEntry(_type: string, data: unknown) {
      storedLoop = data;
    },
    sendUserMessage(message: string) {
      sentMessage = message;
    },
  };

  registerAutoresearchCommand(pi, loop => {
    storedLoop = loop;
  });

  await registered.handler("start 2 3", {
    cwd,
    ui: {
      notify() {},
      confirm: async () => true,
      setStatus() {},
      setWidget() {},
    },
  });

  assert.equal(storedLoop.mode, "assisted");
  assert.equal(storedLoop.maxRuns, 2);
  assert.equal(storedLoop.maxMinutes, 3);
  assert.equal(storedLoop.maxConsecutiveDiscards, 4);
  assert.equal(storedLoop.maxRunsWithoutImprovement, 8);
  assert.equal(storedLoop.maxDiffLines, 33);
  assert.equal(typeof sentMessage, "string");
  const message = sentMessage ?? "";
  assert.ok(message.includes("bounded autoresearch run"));
});

test("package metadata points to existing skill directories", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
    version: string;
    pi: { skills: string[] };
  };

  assert.equal(packageJson.version, "0.3.0");
  assert.deepEqual(packageJson.pi.skills, ["./skills/pi-autoresearch"]);
  assert.equal(existsSync(join(process.cwd(), "skills", "pi-autoresearch", "SKILL.md")), true);
  assert.equal(existsSync(join(process.cwd(), "skills", "autoresearch", "SKILL.md")), true);
});
