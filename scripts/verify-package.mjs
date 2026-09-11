#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

check(pkg.name === "@groeponline/pi-autoresearch", "unexpected package name");
check(pkg.license === "MIT", "license must be MIT");
check(pkg.author === "GroepOnline", "author must be GroepOnline");
check(pkg.publishConfig?.access === "public", "publishConfig.access must be public");
check(pkg.publishConfig?.registry === "https://registry.npmjs.org", "registry must be npmjs.org");
check(pkg.keywords?.includes("pi-package"), "pi-package keyword is required");
check(pkg.keywords?.includes("groeponline"), "groeponline keyword is required");
check(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"] === "*", "Pi host peer must use *");
check(typeof pkg.dependencies?.zod === "string", "zod must remain an explicit runtime dependency");

const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const packed = JSON.parse(raw);
check(Array.isArray(packed) && packed.length === 1, "npm pack must return one tarball");
const files = new Set((packed[0]?.files ?? []).map((entry) => entry.path));
for (const required of [
  "README.md",
  "SECURITY.md",
  "LICENSE",
  "package.json",
  "extensions/autoresearch/index.ts",
  "skills/autoresearch/SKILL.md",
  "scripts/verify-package.mjs",
]) {
  check(files.has(required), `npm tarball missing ${required}`);
}
for (const path of files) {
  check(!/(^|\/)(?:\.env(?:\.|$)|node_modules|tests-ts?|\.git)(?:\/|$)/.test(path), `unsafe/non-runtime path packed: ${path}`);
}

if (failures.length) {
  console.error("Package contract FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Package contract OK: ${pkg.name}@${pkg.version}`);
console.log(`- ${files.size} packed files, ${packed[0].size} bytes`);
