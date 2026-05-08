#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const testArgs = ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"];
const configured = process.env.PYTHON ? [[process.env.PYTHON, []]] : [];
const platformCandidates = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];

for (const [command, prefixArgs] of [...configured, ...platformCandidates]) {
  const result = spawnSync(command, [...prefixArgs, ...testArgs], { stdio: "inherit" });
  if (result.error && result.error.code === "ENOENT") continue;
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error("No Python interpreter found. Set PYTHON or install python/py.");
process.exit(1);
