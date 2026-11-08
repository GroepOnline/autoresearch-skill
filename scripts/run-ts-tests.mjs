#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir = join(root, "tests-ts");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const files = readdirSync(testsDir)
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => join("tests-ts", file));

if (files.length === 0) {
  console.error("No TypeScript tests found in tests-ts.");
  process.exit(1);
}

for (const file of files) {
  console.log(`== ${file} ==`);
  const result = spawnSync(process.execPath, [tsxCli, "--test", file], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
