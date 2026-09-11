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
const packOutput = run("npm", ["pack", "--json", "--pack-destination", outDir]);
const packed = JSON.parse(packOutput);
if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
  throw new Error("npm pack did not return exactly one tarball filename");
}
console.log(join(outDir, packed[0].filename));
