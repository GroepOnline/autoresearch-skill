#!/usr/bin/env node
// Zero-dep release helper. Bumps version, rolls CHANGELOG, tags.
// Ported from GroepOnline/pi-missions (same org policy).
// Local: npm run release [patch|minor|major|auto|x.y.z]
// CI:    node scripts/release.mjs auto --push
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const changelogPath = join(root, "CHANGELOG.md");
const lockPath = join(root, "package-lock.json");

export function bump(version, kind) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  return kind;
}

export function shouldSkipRelease(message) {
  const subject = (message ?? "").trim();
  return /^chore:\s*release\b/i.test(subject) || /\[skip release\]/i.test(subject);
}

export function chooseBump(subjects) {
  // Org policy: every user-visible main change ships as +0.1 minor — small
  // fixes and additions alike. Only an explicit breaking `!:`/"breaking
  // change" auto-promotes to major. Patch stays an explicit manual choice
  // (`node scripts/release.mjs patch`). Major wins over the whole set: every
  // subject is scanned so a breaking marker later in the list still promotes.
  let seen = false;
  for (const raw of subjects) {
    const subject = raw.trim();
    if (!subject || /^chore:\s*release\b/i.test(subject)) continue;
    if (/^(\w+)(\([^)]+\))?!:/.test(subject) || /breaking change/i.test(subject)) {
      return "major";
    }
    seen = true;
  }
  return seen ? "minor" : "patch";
}

function git(command) {
  return execSync(command, { cwd: root, encoding: "utf8" }).trim();
}

function atomicWriteFile(path, content) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tempPath, "wx");
  let closed = false;
  try {
    writeSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    closed = true;
    renameSync(tempPath, path);
  } catch (error) {
    if (!closed) closeSync(fd);
    try {
      unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function lastReleaseTag() {
  try {
    return parseLatestVersionTag(git("git tag -l 'v*'").split("\n"));
  } catch {
    return null;
  }
}

function refExists(ref) {
  try {
    git(`git rev-parse -q --verify ${ref}`);
    return true;
  } catch {
    return false;
  }
}

function commitSubjectsSince(tag) {
  const log = git(tag ? `git log ${tag}..HEAD --pretty=%s` : "git log --pretty=%s");
  return log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildReleaseNotesFromSubjects(subjects) {
  const groups = new Map([
    ["Added", []],
    ["Fixed", []],
    ["Security", []],
    ["Changed", []],
    ["Documentation", []],
    ["Maintenance", []],
  ]);

  for (const raw of subjects) {
    const subject = raw.trim();
    if (!subject || /^chore:\s*release\b/i.test(subject)) continue;

    const match = /^(\w+)(?:\([^)]+\))?(!)?:\s*(.+)$/.exec(subject);
    const type = match?.[1]?.toLowerCase() ?? "";
    const description = match?.[3]?.trim() || subject;
    let group = "Changed";
    if (type === "feat") group = "Added";
    else if (type === "fix") group = "Fixed";
    else if (type === "security") group = "Security";
    else if (type === "docs") group = "Documentation";
    else if (["ci", "build", "chore", "test"].includes(type)) group = "Maintenance";
    else if (["perf", "refactor"].includes(type)) group = "Changed";
    groups.get(group).push(`- ${description}`);
  }

  const sections = [];
  for (const [heading, lines] of groups) {
    if (lines.length > 0) sections.push(`### ${heading}\n${lines.join("\n")}`);
  }
  if (sections.length === 0) {
    return "### Maintenance\n- Release metadata only; no user-facing changes were detected.";
  }
  return sections.join("\n\n");
}

export function seedUnreleasedNotes(changelog, subjects) {
  const heading = /^## \[Unreleased\][ \t]*$/m;
  const match = heading.exec(changelog);
  if (!match) return { changelog, seeded: false };

  const bodyStart = match.index + match[0].length;
  const rest = changelog.slice(bodyStart);
  const nextHeading = rest.search(/^## \[/m);
  const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  if (body) return { changelog, seeded: false };

  const notes = buildReleaseNotesFromSubjects(subjects);
  return {
    changelog:
      changelog.slice(0, bodyStart) +
      `\n\n${notes}\n` +
      changelog.slice(bodyStart).replace(/^\s*/, ""),
    seeded: true,
  };
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const kind = argv.find((arg) => !arg.startsWith("--")) ?? "patch";
  return { flags, kind };
}

export function parseLatestVersionTag(names) {
  const versions = names
    .map((name) => name.trim())
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
    .map((tag) => ({
      tag,
      parts: tag.slice(1).split(".").map(Number),
    }));
  versions.sort(
    (a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2]
  );
  return versions.at(-1)?.tag ?? null;
}

export function resolveReleaseVersion(current, kindArg, subjects) {
  const kind = kindArg === "auto" ? chooseBump(subjects) : kindArg;
  const next = bump(current, kind);
  if (!/^\d+\.\d+\.\d+$/.test(next)) {
    throw new Error(`Invalid version: ${next}`);
  }
  return { kind, next };
}

export function existingTagAction(currentVersion, next, tagExists) {
  if (!tagExists) return "cut";
  if (currentVersion === next) return "already-cut";
  return "collision";
}

export function rewritePackageLockVersion(lockText, next) {
  const lock = JSON.parse(lockText);
  lock.version = next;
  if (lock.packages?.[""]) lock.packages[""].version = next;
  return JSON.stringify(lock, null, 2) + "\n";
}

export function rewriteUnreleasedHeading(changelog, next, date) {
  const unreleasedHeading = /^## \[Unreleased\][ \t]*$/m;
  if (!unreleasedHeading.test(changelog)) {
    return { changelog, rewritten: false };
  }
  return {
    changelog: changelog.replace(unreleasedHeading, `## [Unreleased]\n\n## [${next}] - ${date}`),
    rewritten: true,
  };
}

/** Body under `## [version]` up to the next heading. Empty when missing. */
export function extractChangelogNotes(changelog, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
  const heading = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n`, "m");
  const match = heading.exec(changelog);
  if (!match) return "";
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^## \[/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function main() {
  const { flags, kind: kindArg } = parseArgs(process.argv.slice(2));
  const headSubject = git("git log -1 --pretty=%s");
  if (flags.has("--push") && shouldSkipRelease(headSubject)) {
    console.log(`Skipping release (${headSubject}).`);
    return;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const tagBase = lastReleaseTag();
  const subjects = commitSubjectsSince(tagBase);
  const { kind, next } = resolveReleaseVersion(pkg.version, kindArg, subjects);
  const tag = `v${next}`;

  if (flags.has("--dry-run")) {
    console.log(`Would release ${next} (${kind}) as ${tag} since ${tagBase ?? "no tag"}.`);
    return;
  }

  const tagAction = existingTagAction(pkg.version, next, refExists(`refs/tags/${tag}`));
  if (tagAction === "already-cut") {
    console.log(`Tag ${tag} already exists and package.json is ${next}; skip bump.`);
    return;
  }
  if (tagAction === "collision") {
    throw new Error(`Tag ${tag} already exists; refusing to bump ${pkg.version} -> ${next}.`);
  }

  pkg.version = next;
  atomicWriteFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  if (existsSync(lockPath)) {
    writeFileSync(lockPath, rewritePackageLockVersion(readFileSync(lockPath, "utf8"), next));
  }

  const date = new Date().toISOString().slice(0, 10);
  const changelog = readFileSync(changelogPath, "utf8");
  const seeded = seedUnreleasedNotes(changelog, subjects);
  if (seeded.seeded) {
    console.log("CHANGELOG: generated fallback notes from commit subjects.");
  }
  const rolled = rewriteUnreleasedHeading(seeded.changelog, next, date);
  if (rolled.rewritten) {
    atomicWriteFile(changelogPath, rolled.changelog);
    console.log(`CHANGELOG: [Unreleased] -> [${next}] - ${date}`);
  } else {
    console.log("No [Unreleased] section; leaving CHANGELOG as-is.");
  }

  execSync("git add package.json package-lock.json CHANGELOG.md", { cwd: root, stdio: "inherit" });
  execSync(`git commit -m "chore: release ${next}"`, { cwd: root, stdio: "inherit" });
  execSync(`git tag -a ${tag} -m "Release ${next}"`, { cwd: root, stdio: "inherit" });

  console.log(`\nRelease ${next} tagged as ${tag}.`);
  if (flags.has("--push")) {
    execSync("git push origin HEAD:refs/heads/main", { cwd: root, stdio: "inherit" });
    execSync(`git push origin refs/tags/${tag}`, { cwd: root, stdio: "inherit" });
    console.log(`Pushed main and ${tag}.`);
  } else {
    console.log(`Push with:\n  git push origin HEAD refs/tags/${tag}`);
  }
  console.log("After publish, confirm the Pi catalog card:");
  console.log("  https://pi.dev/packages/@groeponline/pi-autoresearch");
  console.log("  https://pi.dev/packages?name=autoresearch");
  console.log("  https://pi.dev/packages?name=groeponline");
}

const invokedAsCli =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  try {
    if (process.argv[2] === "notes") {
      const version = process.argv[3];
      if (!version) throw new Error("usage: node scripts/release.mjs notes <version>");
      const changelog = readFileSync(changelogPath, "utf8");
      process.stdout.write(extractChangelogNotes(changelog, version) + "\n");
    } else {
      main();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
