import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { paths } from "./state.js";

export interface GitIsolationStatus {
  inGitRepo: boolean;
  branch: string | null;
  isWorktree: boolean;
  isolated: boolean;
}

export interface AutoresearchContract {
  filesInScope: string[];
  offLimits: string[];
  placeholders?: string[];
}

export interface PolicyDecision {
  block: boolean;
  reason?: string;
}

// Module-level diff-size limit. Ralph mode sets this to 10; assisted mode to 50.
let currentMaxDiffLines = 50;

export function setMaxDiffLines(n: number): void {
  currentMaxDiffLines = n;
}

export function getMaxDiffLines(): number {
  return currentMaxDiffLines;
}

const DEFAULT_PROTECTED_PATTERNS = [
  /^\.git(?:\/|$)/,
  /^node_modules(?:\/|$)/,
  /^\.env(?:\.|$)/,
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/)(?:id_rsa|id_ed25519|known_hosts)$/,
  /(?:^|\/).*\.(?:pem|key|p12|pfx)$/,
];

const RUNTIME_ARTIFACT_PATTERNS = [
  /^autoresearch\.md$/,
  /^autoresearch\.jsonl$/,
  /^AUTORESEARCH_STATE.*\.json$/,
  /^AUTORESEARCH_LOG\.md$/,
  /^autoresearch-dashboard\.md$/,
  /^autoresearch\.ideas\.md$/,
  /^autoresearch\.sh$/,
  /^\.autoresearch-off$/,
  /^experiments(?:\/|$)/,
  /^\.autoresearch(?:\/|$)/,
];

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-[^\n;|&]*r[^\n;|&]*f\s+(?:\/|~|\$HOME)(?:\s|$)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[^\n;|&]*[fd][^\n;|&]*\b/,
  /\bgit\s+checkout\s+--\s+\.\b/,
  /\bgit\s+restore\s+[^\n;|&]*(?:--staged\s+)?--worktree\s+\.\b/,
  /\bsudo\b/,
  /\bchmod\s+-R\s+777\b/,
  /(?:curl|wget)[^\n|;&]*\|\s*(?:sh|bash)\b/,
];

function normalizeRelativePath(cwd: string, rawPath: string): string {
  const withoutAt = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  const absolute = path.isAbsolute(withoutAt) ? withoutAt : path.resolve(cwd, withoutAt);
  return path.relative(cwd, absolute).replaceAll(path.sep, "/");
}

function pathMatches(patterns: string[], relPath: string): boolean {
  return patterns.some(pattern => {
    const normalized = pattern.replaceAll(path.sep, "/").replace(/^\.\//, "").trim();
    if (!normalized || normalized.includes("<")) return false;
    return relPath === normalized || relPath.startsWith(`${normalized.replace(/\/$/, "")}/`);
  });
}

export function isRuntimeArtifact(relPath: string): boolean {
  return RUNTIME_ARTIFACT_PATTERNS.some(pattern => pattern.test(relPath));
}

export function isProtectedPath(relPath: string): boolean {
  return DEFAULT_PROTECTED_PATTERNS.some(pattern => pattern.test(relPath));
}

function cleanSectionLine(line: string): string {
  return line.replace(/^\s*[-*]\s*/, "").replace(/^`|`$/g, "").trim();
}

function extractSection(markdown: string, heading: string): { values: string[]; placeholders: string[] } {
  const lines = markdown.split("\n");
  const start = lines.findIndex(line => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return { values: [], placeholders: [`missing section: ${heading}`] };

  const values: string[] = [];
  const placeholders: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    const cleaned = cleanSectionLine(line);
    if (!cleaned) continue;
    if (cleaned.includes("<") || cleaned.includes(">")) {
      placeholders.push(`${heading}: ${cleaned}`);
      continue;
    }
    if (/^(none|n\/a|no restrictions|geen|geen beperkingen)$/i.test(cleaned)) continue;
    values.push(cleaned);
  }
  return { values, placeholders };
}

export function parseContract(markdown: string): AutoresearchContract {
  const scope = extractSection(markdown, "Files in Scope");
  const offLimits = extractSection(markdown, "Off Limits");
  return {
    filesInScope: scope.values,
    offLimits: offLimits.values,
    placeholders: [...scope.placeholders, ...offLimits.placeholders],
  };
}

export function readContract(cwd: string): AutoresearchContract {
  const context = paths(cwd).context;
  if (!fs.existsSync(context)) return { filesInScope: [], offLimits: [], placeholders: ["missing autoresearch.md"] };
  return parseContract(fs.readFileSync(context, "utf-8"));
}

export function validateContractForStart(contract: AutoresearchContract): string[] {
  const errors: string[] = [];
  if (contract.placeholders && contract.placeholders.length > 0) {
    errors.push(`autoresearch.md bevat nog placeholders: ${contract.placeholders.join("; ")}`);
  }
  if (contract.filesInScope.length === 0) {
    errors.push("Files in Scope is leeg. Vul minimaal een bestand of map in voordat /autoresearch start.");
  }
  return errors;
}

function evaluatePathMutation(cwd: string, rawPath: unknown, contract: AutoresearchContract): PolicyDecision {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return { block: true, reason: "Autoresearch policy: mutation path is missing." };
  }

  const relPath = normalizeRelativePath(cwd, rawPath);
  if (relPath.startsWith("..")) {
    return { block: true, reason: `Autoresearch policy: path escapes project root: ${rawPath}` };
  }
  if (isProtectedPath(relPath)) {
    return { block: true, reason: `Autoresearch policy: protected path blocked: ${relPath}` };
  }
  if (pathMatches(contract.offLimits, relPath)) {
    return { block: true, reason: `Autoresearch policy: off-limits path blocked: ${relPath}` };
  }
  if (!isRuntimeArtifact(relPath) && contract.filesInScope.length === 0) {
    return { block: true, reason: `Autoresearch policy: Files in Scope is empty; refusing mutation: ${relPath}` };
  }
  if (contract.filesInScope.length > 0 && !isRuntimeArtifact(relPath) && !pathMatches(contract.filesInScope, relPath)) {
    return { block: true, reason: `Autoresearch policy: path is outside Files in Scope: ${relPath}` };
  }
  return { block: false };
}

export function evaluateBashCommand(command: string): PolicyDecision {
  const compact = command.replace(/\\\n/g, "\n");
  for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (pattern.test(compact)) {
      return { block: true, reason: `Autoresearch policy: destructive command blocked: ${command}` };
    }
  }
  return { block: false };
}

function evaluateDiffSize(toolName: string, input: Record<string, unknown>): PolicyDecision {
  if (currentMaxDiffLines <= 0) return { block: false }; // 0 or negative = no limit
  if (!["write", "edit", "str_replace"].includes(toolName)) return { block: false };

  let totalChangedLines = 0;

  if (toolName === "write") {
    const content = input.content;
    if (typeof content === "string") {
      totalChangedLines = content.split("\n").length;
    }
  } else {
    const replacements = input.replacements;
    if (Array.isArray(replacements)) {
      for (const r of replacements) {
        if (typeof r === "object" && r) {
          const rec = r as Record<string, unknown>;
          const oldLines = typeof rec.old === "string" ? rec.old.split("\n").length : 0;
          const newLines = typeof rec.new === "string" ? rec.new.split("\n").length : 0;
          totalChangedLines += Math.max(oldLines, newLines);
        }
      }
    } else {
      const oldStr = typeof input.old === "string" ? input.old : typeof input.old_str === "string" ? input.old_str : "";
      const newStr = typeof input.new === "string" ? input.new : typeof input.new_str === "string" ? input.new_str : "";
      if (oldStr || newStr) {
        totalChangedLines = Math.max(oldStr.split("\n").length, newStr.split("\n").length);
      }
    }
  }

  if (totalChangedLines > currentMaxDiffLines) {
    return {
      block: true,
      reason: `Autoresearch policy: diff too large (${totalChangedLines} lines, max ${currentMaxDiffLines}). Wijs kleine, incrementele wijzigingen toe.`,
    };
  }

  return { block: false };
}

export function evaluateToolCall(toolName: string, input: Record<string, unknown>, cwd: string, contract = readContract(cwd)): PolicyDecision {
  if (toolName === "bash") {
    const command = input.command;
    if (typeof command !== "string") return { block: true, reason: "Autoresearch policy: bash command is missing." };
    return evaluateBashCommand(command);
  }

  if (toolName === "write" || toolName === "edit" || toolName === "str_replace") {
    const pathDecision = evaluatePathMutation(cwd, input.path, contract);
    if (pathDecision.block) return pathDecision;
    const sizeDecision = evaluateDiffSize(toolName, input);
    if (sizeDecision.block) return sizeDecision;
  }

  return { block: false };
}

function parseGitStatusPorcelain(status: string): string[] {
  return status.split("\n")
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => {
      const rawPath = line.length > 3 ? line.slice(3) : line;
      const renameTarget = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() ?? rawPath : rawPath;
      return renameTarget.replace(/^"|"$/g, "").replaceAll(path.sep, "/");
    });
}

export function dirtyGitPaths(cwd: string): string[] | null {
  try {
    const status = execSync("git status --porcelain", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return parseGitStatusPorcelain(status);
  } catch {
    return null; // not a git repo, or git unavailable
  }
}

export function dirtyUserPaths(cwd: string): string[] {
  const paths = dirtyGitPaths(cwd);
  if (paths === null) return [];
  return paths.filter(relPath => !isRuntimeArtifact(relPath));
}

function safeGit(cwd: string, command: string): string | null {
  try {
    return execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

export function gitIsolationStatus(cwd: string): GitIsolationStatus {
  const inGitRepo = safeGit(cwd, "git rev-parse --is-inside-work-tree") === "true";
  if (!inGitRepo) return { inGitRepo: false, branch: null, isWorktree: false, isolated: false };

  const branch = safeGit(cwd, "git branch --show-current") || null;
  const gitDir = safeGit(cwd, "git rev-parse --git-dir") || "";
  const isWorktree = gitDir.includes("/worktrees/") || gitDir.includes("\\worktrees\\");
  const isAutoresearchBranch = typeof branch === "string" && /^autoresearch\//.test(branch);

  return {
    inGitRepo: true,
    branch,
    isWorktree,
    isolated: Boolean(isAutoresearchBranch || isWorktree),
  };
}

export function ensureAutoresearchBranch(cwd: string, preferredName?: string): { ok: boolean; branch?: string; reason?: string } {
  const status = gitIsolationStatus(cwd);
  if (!status.inGitRepo) return { ok: false, reason: "geen git repository gedetecteerd" };
  if (status.isolated) return { ok: true, branch: status.branch ?? undefined };

  const slug = (preferredName ?? "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "session";
  const branch = `autoresearch/${slug}`;

  try {
    execSync(`git switch -c ${JSON.stringify(branch)}`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, branch };
  } catch {
    return {
      ok: false,
      reason: `kan niet automatisch isoleren. Maak eerst een aparte branch/worktree, bv: git switch -c ${branch}`,
    };
  }
}

function countFileLines(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      let total = 0;
      for (const entry of fs.readdirSync(filePath)) {
        total += countFileLines(path.join(filePath, entry));
      }
      return total;
    }
    if (!stat.isFile()) return 0;
    const text = fs.readFileSync(filePath, "utf-8");
    return text.length === 0 ? 0 : text.split("\n").length;
  } catch {
    return 0;
  }
}

function countChangedLines(cwd: string, relPath: string): number {
  let total = 0;
  for (const command of ["git diff --numstat --", "git diff --cached --numstat --"]) {
    try {
      const output = execSync(`${command} ${JSON.stringify(relPath)}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      for (const line of output.split("\n")) {
        const [added, deleted] = line.trim().split(/\s+/);
        const addCount = Number.parseInt(added, 10);
        const delCount = Number.parseInt(deleted, 10);
        if (Number.isFinite(addCount)) total += addCount;
        if (Number.isFinite(delCount)) total += delCount;
      }
    } catch {
      // Ignore per-path diff failures; untracked files are counted below.
    }
  }
  if (total === 0 && fs.existsSync(path.join(cwd, relPath))) {
    total = countFileLines(path.join(cwd, relPath));
  }
  return total;
}

export function evaluateWorkingTreeMutation(cwd: string, contract = readContract(cwd)): PolicyDecision {
  const dirty = dirtyGitPaths(cwd);
  if (dirty === null || dirty.length === 0) return { block: false };

  let changedLines = 0;
  for (const relPath of dirty) {
    if (isRuntimeArtifact(relPath)) continue;
    const pathDecision = evaluatePathMutation(cwd, relPath, contract);
    if (pathDecision.block) return pathDecision;
    changedLines += countChangedLines(cwd, relPath);
  }

  if (currentMaxDiffLines > 0 && changedLines > currentMaxDiffLines) {
    return {
      block: true,
      reason: `Autoresearch policy: post-run diff too large (${changedLines} changed lines, max ${currentMaxDiffLines}). Bash/file mutations are blocked until reduced.`,
    };
  }

  return { block: false };
}

export function hasAutoresearchSession(cwd: string): boolean {
  const p = paths(cwd);
  return fs.existsSync(p.context) || fs.existsSync(p.jsonl);
}
