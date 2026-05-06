import * as fs from "node:fs";
import * as path from "node:path";
import { paths } from "./state.js";

export interface AutoresearchContract {
  filesInScope: string[];
  offLimits: string[];
}

export interface PolicyDecision {
  block: boolean;
  reason?: string;
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

function extractSectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex(line => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return [];

  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    const cleaned = line.replace(/^\s*[-*]\s*/, "").replace(/^`|`$/g, "").trim();
    if (!cleaned || cleaned.includes("<")) continue;
    values.push(cleaned);
  }
  return values;
}

export function parseContract(markdown: string): AutoresearchContract {
  return {
    filesInScope: extractSectionLines(markdown, "Files in Scope"),
    offLimits: extractSectionLines(markdown, "Off Limits"),
  };
}

export function readContract(cwd: string): AutoresearchContract {
  const context = paths(cwd).context;
  if (!fs.existsSync(context)) return { filesInScope: [], offLimits: [] };
  return parseContract(fs.readFileSync(context, "utf-8"));
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

export function evaluateToolCall(toolName: string, input: Record<string, unknown>, cwd: string, contract = readContract(cwd)): PolicyDecision {
  if (toolName === "bash") {
    const command = input.command;
    if (typeof command !== "string") return { block: true, reason: "Autoresearch policy: bash command is missing." };
    return evaluateBashCommand(command);
  }

  if (toolName === "write" || toolName === "edit") {
    return evaluatePathMutation(cwd, input.path, contract);
  }

  return { block: false };
}

export function hasAutoresearchSession(cwd: string): boolean {
  const p = paths(cwd);
  return fs.existsSync(p.context) || fs.existsSync(p.jsonl);
}
