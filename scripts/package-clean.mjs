#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = resolve(root, process.argv[2] ?? "dist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf-8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} ${args.join(" ")} failed`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

try {
  const insideGit = run("git", ["rev-parse", "--is-inside-work-tree"]);
  if (insideGit === "true") {
    const dirty = run("git", ["status", "--porcelain"]);
    if (dirty) {
      console.error("Refusing to package from a dirty git tree:");
      console.error(dirty);
      process.exit(1);
    }
  }
} catch (error) {
  if (error instanceof Error && !/not a git repository/i.test(error.message)) {
    console.error(error.message);
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
run("npm", ["pack", "--pack-destination", outDir], { stdio: "inherit" });
console.log(join(outDir, `${pkg.name}-${pkg.version}.tgz`));
