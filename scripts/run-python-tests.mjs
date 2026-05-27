#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const testArgs = ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"];
const configured = process.env.PYTHON ? [[process.env.PYTHON, []]] : [];
const platformCandidates = process.platform === "win32"
  ? [["python", []], ["python3", []], ["py", ["-3"]]]
  : [["python3", []], ["python", []]];

for (const [command, prefixArgs] of [...configured, ...platformCandidates]) {
  const result = spawnSync(command, [...prefixArgs, ...testArgs], { stdio: "inherit" });
  if (result.error && result.error.code === "ENOENT") continue;
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0 && !process.env.PYTHON && process.platform === "win32") {
    const probe = spawnSync(command, [...prefixArgs, "--version"], { stdio: "ignore" });
    if (probe.error?.code === "ENOENT" || probe.status !== 0) continue;
  }
  process.exit(result.status ?? 1);
}

console.error("No Python interpreter found. Set PYTHON or install python/py.");
process.exit(1);
