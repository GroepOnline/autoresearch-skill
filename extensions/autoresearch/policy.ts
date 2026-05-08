import { spawnSync } from "node:child_process";
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
  errors?: string[];
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

// Maximum input sizes to prevent DoS
const MAX_COMMAND_LENGTH = 10000;  // 10KB max command length
const MAX_PATH_LENGTH = 500;       // 500 chars max path length

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

// Whitelist of allowed bash commands with their allowed argument patterns
// Each entry: [command, allowedArgPattern]
const ALLOWED_COMMAND_WHITELIST: Array<[string, RegExp | null]> = [
  // Build & test tools
  ["npm", /^(run|test|run\s+\S+|install|ci|build|start|lint|format|typecheck)(?:\s|$)/],
  ["yarn", /^(install|add|remove|run|test|build|start|lint|format)(?:\s|$)/],
  ["pnpm", /^(install|add|remove|run|test|build|start|lint|format)(?:\s|$)/],
  ["python", /^(-m\s+\S+|--version|--help|\S+\.py\b)(?:\s|$)/],
  ["python3", /^(-m\s+\S+|--version|--help|\S+\.py\b)(?:\s|$)/],
  ["pytest", /^(-v|--verbose|-x|--tb=\S+|-k\s+\S+|\S+\.py\b|tests\/)(?:\s|$)/],
  ["node", /^(--version|--help|scripts\/\S+\.mjs|\S+\.mjs|\S+\.js|-e\s+)/],
  ["npx", /^(\S+)(?:\s|$)/],
  
  // Git read-only operations
  ["git", /^(status|log|diff|show|branch|rev-parse|ls-files|ls-tree)(?:\s|$)/],
  
  // File operations (read-only)
  ["cat", /^(\S+)$/],
  ["head", /^(-n\s+\d+|\S+)$/],
  ["tail", /^(-n\s+\d+|\S+)$/],
  ["ls", /^(-la|-la\s+\S+|\S+)$/],
  ["find", /^(\S+)(?:\s|$)/],
  ["wc", /^(-l|\S+)(?:\s|$)/],
  ["grep", /^(-\w+|\S+)(?:\s|$)/],
  
  // Environment info
  ["echo", /^(.*)$/],
  ["pwd", null],
  ["which", /^(\S+)$/],
  ["date", null],
  ["uname", /^(-a)?$/],
  ["env", null],
];

// Dangerous patterns that are always blocked (defense in depth)
const ALWAYS_BLOCKED_PATTERNS = [
  /\brm\s+-[^\n;|&]*r[^\n;|&]*f\s+(?:\/|~|\$HOME)(?:\s|$)/,
  /\bsudo\b/,
  /\bchmod\s+-R\s+777\b/,
  /(?:curl|wget)[^\n|;&]*\|\s*(?:sh|bash)\b/,
  /\b(eval|exec)\s+\(/,
  /\$\([^)]+\)/,  // Command substitution $()
  /`[^`]+`/,       // Backtick command substitution
  /\$\{[^}]+\}/,   // Variable expansion that could be dangerous
];

const SHELL_PROTECTED_PATH_PATTERNS = [
  /(?:^|[\s"'=<>;&|])(?:\.\/)?\.env(?:\.|[\s"'<>;&|]|$)/,
  /(?:^|[\s"'=<>;&|])(?:\.\/)?(?:id_rsa|id_ed25519|known_hosts)(?=$|[\s"'<>;&|])/,
  /(?:^|[\s"'=<>;&|])(?:\.\/)?(?:[^\s"'<>;&|/]+\/)*(?:id_rsa|id_ed25519|known_hosts)(?=$|[\s"'<>;&|])/,
  /(?:^|[\s"'=<>;&|])(?:\.\/)?[^\s"'<>;&|]*\.(?:pem|key|p12|pfx)(?=$|[\s"'<>;&|])/,
];

function normalizeRelativePath(cwd: string, rawPath: string): string {
  const withoutAt = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  const absolute = path.isAbsolute(withoutAt) ? withoutAt : path.resolve(cwd, withoutAt);
  return path.relative(cwd, absolute).replaceAll(path.sep, "/");
}

function pathMatches(patterns: string[], relPath: string): boolean {
  return patterns.some(pattern => {
    const raw = pattern.replaceAll(path.sep, "/").trim();
    if (!raw || raw.includes("<")) return false;
    if (raw === "." || raw === "./") return true;
    const normalized = raw.replace(/^\.\//, "").replace(/\/$/, "");
    return relPath === normalized || relPath.startsWith(`${normalized}/`);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commandMentionsPath(command: string, relPath: string): boolean {
  const normalizedCommand = command.replaceAll("\\", "/");
  const normalizedPath = relPath.replaceAll(path.sep, "/").replace(/^\.\//, "").replace(/\/$/, "").trim();
  if (!normalizedPath || normalizedPath === "." || normalizedPath.includes("<")) return false;
  const pattern = new RegExp(`(?:^|[\\s"'=<>;&|])(?:\\./)?${escapeRegExp(normalizedPath)}(?=$|[\\s"'<>;&|])`);
  return pattern.test(normalizedCommand);
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

// Validate that a path is syntactically safe (no path traversal, no absolute paths outside cwd)
function validatePathSyntax(pathStr: string): { valid: boolean; error?: string } {
  // Block path traversal attempts
  if (pathStr.includes("..")) {
    return { valid: false, error: `path traversal not allowed: ${pathStr}` };
  }
  
  // Block null bytes
  if (pathStr.includes("\0")) {
    return { valid: false, error: `null bytes not allowed in path: ${pathStr}` };
  }
  
  // Block extremely long paths (potential DoS)
  if (pathStr.length > 500) {
    return { valid: false, error: `path too long (max 500 chars): ${pathStr.length} chars` };
  }
  
  // Block dangerous characters for Windows
  if (/[<>:"|?*]/.test(pathStr)) {
    return { valid: false, error: `invalid characters in path: ${pathStr}` };
  }
  
  return { valid: true };
}

function extractSection(markdown: string, heading: string): { values: string[]; placeholders: string[]; errors: string[] } {
  const lines = markdown.split("\n");
  const start = lines.findIndex(line => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return { values: [], placeholders: [`missing section: ${heading}`], errors: [] };

  const values: string[] = [];
  const placeholders: string[] = [];
  const errors: string[] = [];
  
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    const cleaned = cleanSectionLine(line);
    if (!cleaned) continue;
    
    if (cleaned.includes("<") || cleaned.includes(">")) {
      placeholders.push(`${heading}: ${cleaned}`);
      continue;
    }
    
    if (/^(none|n\/a|no restrictions|geen|geen beperkingen)$/i.test(cleaned)) continue;
    
    // Validate path syntax
    const validation = validatePathSyntax(cleaned);
    if (!validation.valid) {
      errors.push(`${heading}: ${validation.error}`);
      continue;
    }
    
    values.push(cleaned);
  }
  
  return { values, placeholders, errors };
}

export function parseContract(markdown: string): AutoresearchContract {
  const scope = extractSection(markdown, "Files in Scope");
  const offLimits = extractSection(markdown, "Off Limits");
  return {
    filesInScope: scope.values,
    offLimits: offLimits.values,
    placeholders: [...scope.placeholders, ...offLimits.placeholders],
    errors: [...scope.errors, ...offLimits.errors],
  };
}

export function readContract(cwd: string): AutoresearchContract {
  const context = paths(cwd).context;
  if (!fs.existsSync(context)) return { filesInScope: [], offLimits: [], placeholders: ["missing autoresearch.md"], errors: [] };
  return parseContract(fs.readFileSync(context, "utf-8"));
}

export function validateContractForStart(contract: AutoresearchContract): string[] {
  const errors: string[] = [];
  if (contract.placeholders && contract.placeholders.length > 0) {
    errors.push(`autoresearch.md bevat nog placeholders: ${contract.placeholders.join("; ")}`);
  }
  if (contract.errors && contract.errors.length > 0) {
    errors.push(...contract.errors);
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

  // Size validation to prevent DoS
  if (rawPath.length > MAX_PATH_LENGTH) {
    return { block: true, reason: `Autoresearch policy: path too long (${rawPath.length} chars, max ${MAX_PATH_LENGTH})` };
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

export function evaluateBashCommand(command: string, _cwd?: string, contract?: AutoresearchContract): PolicyDecision {
  // Size validation to prevent DoS
  if (command.length > MAX_COMMAND_LENGTH) {
    return { block: true, reason: `Autoresearch policy: command too long (${command.length} chars, max ${MAX_COMMAND_LENGTH})` };
  }
  
  const compact = command.replace(/\\\n/g, "\n");
  
  // Check always-blocked patterns first (defense in depth)
  for (const pattern of ALWAYS_BLOCKED_PATTERNS) {
    if (pattern.test(compact)) {
      return { block: true, reason: `Autoresearch policy: dangerous pattern detected in command: ${command}` };
    }
  }
  
  // Check protected paths in command
  for (const pattern of SHELL_PROTECTED_PATH_PATTERNS) {
    if (pattern.test(compact.replaceAll("\\", "/"))) {
      return { block: true, reason: `Autoresearch policy: protected path referenced by shell command: ${command}` };
    }
  }
  
  // Check off-limits paths
  if (contract) {
    for (const relPath of contract.offLimits) {
      if (commandMentionsPath(compact, relPath)) {
        return { block: true, reason: `Autoresearch policy: off-limits path referenced by shell command: ${relPath}` };
      }
    }
  }
  
  // Extract command name and arguments
  const trimmed = compact.trim();
  const firstSpace = trimmed.indexOf(" ");
  const cmdName = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const cmdArgs = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1);
  
  // Check against whitelist
  const whitelistEntry = ALLOWED_COMMAND_WHITELIST.find(([name]) => name === cmdName);
  if (!whitelistEntry) {
    return { block: true, reason: `Autoresearch policy: command not in whitelist: ${cmdName}` };
  }
  
  // Validate arguments against pattern
  const [, argPattern] = whitelistEntry;
  if (argPattern && cmdArgs.length > 0) {
    if (!argPattern.test(cmdArgs)) {
      return { block: true, reason: `Autoresearch policy: invalid arguments for ${cmdName}: ${cmdArgs}` };
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
    return evaluateBashCommand(command, cwd, contract);
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
    const result = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    if (result.status !== 0) return null;
    return parseGitStatusPorcelain(result.stdout);
  } catch {
    return null; // not a git repo, or git unavailable
  }
}

export function dirtyUserPaths(cwd: string): string[] {
  const paths = dirtyGitPaths(cwd);
  if (paths === null) return [];
  return paths.filter(relPath => !isRuntimeArtifact(relPath));
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

export function gitIsolationStatus(cwd: string): GitIsolationStatus {
  const inGitRepo = safeGit(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!inGitRepo) return { inGitRepo: false, branch: null, isWorktree: false, isolated: false };

  const branch = safeGit(cwd, ["branch", "--show-current"]) || null;
  const gitDir = safeGit(cwd, ["rev-parse", "--git-dir"]) || "";
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
    const result = spawnSync("git", ["switch", "-c", branch], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    if (result.status === 0) {
      return { ok: true, branch };
    }
    return {
      ok: false,
      reason: `kan niet automatisch isoleren. Maak eerst een aparte branch/worktree, bv: git switch -c ${branch}`,
    };
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
  for (const args of [["diff", "--numstat", "--", relPath], ["diff", "--cached", "--numstat", "--", relPath]]) {
    try {
      const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      if (result.status !== 0) continue;
      for (const line of result.stdout.split("\n")) {
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
