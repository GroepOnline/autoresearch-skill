#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(label, command, args) {
  console.log(`== ${label} ==`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("Python tests", process.execPath, [join(root, "scripts", "run-python-tests.mjs")]);
run("TypeScript tests", process.execPath, [join(root, "scripts", "run-ts-tests.mjs")]);
run("TypeScript typecheck", process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"]);
