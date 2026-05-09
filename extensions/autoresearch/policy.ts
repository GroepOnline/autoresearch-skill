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

export interface SecurityAuditEntry {
  type: "security_block";
  timestamp: string;
  tool: string;
  reason: string;
  path?: string;
  commandPreview?: string;
  inputKeys?: string[];
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

function isSensitivePath(relPath: string): boolean {
  return [
    /^\.env(?:\.|$)/,
    /(?:^|\/)\.env(?:\.|$)/,
    /(?:^|\/)(?:id_rsa|id_ed25519|known_hosts)$/,
    /(?:^|\/).*\.(?:pem|key|p12|pfx)$/,
  ].some(pattern => pattern.test(relPath));
}

function redactPathForAudit(rawPath: string): string {
  const normalized = rawPath.replaceAll(path.sep, "/").trim();
  if (!normalized) return "[redacted path]";
  if (isSensitivePath(normalized)) return "[redacted path]";
  return normalized;
}

function redactSensitiveText(text: string): string {
  let redacted = text.replaceAll(path.sep, "/");
  redacted = redacted.replace(/\bAuthorization\s*:\s*[^'"\n\r]+/gi, "Authorization: [redacted]");
  redacted = redacted.replace(/\bAuthorization\s*=\s*[^'"\n\r]+/gi, "Authorization=[redacted]");
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
  redacted = redacted.replace(/\b(?:api[-_]?key|token|secret|password|passwd)\s*[:=]\s*['\"]?[^'\"`\s]+['\"]?/gi, match => {
    const idx = match.search(/[:=]/);
    return idx >= 0 ? `${match.slice(0, idx + 1)}[redacted]` : "[redacted]";
  });
  redacted = redacted.replace(/\.env(?:\.[A-Za-z0-9_-]+)?/gi, "[redacted-env]");
  redacted = redacted.replace(/\b(?:id_rsa|id_ed25519|known_hosts)\b/gi, "[redacted-key]");
  return redacted;
}

function previewCommand(command: string): string {
  return redactSensitiveText(command.replace(/\s+/g, " ").trim()).slice(0, 200);
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

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function editSizeFromEntry(entry: unknown): number {
  if (!entry || typeof entry !== "object") return 0;
  const record = entry as Record<string, unknown>;
  const oldText = typeof record.oldText === "string"
    ? record.oldText
    : typeof record.old === "string"
      ? record.old
      : typeof record.old_str === "string"
        ? record.old_str
        : "";
  const newText = typeof record.newText === "string"
    ? record.newText
    : typeof record.new === "string"
      ? record.new
      : typeof record.new_str === "string"
        ? record.new_str
        : "";
  return Math.max(countLines(oldText), countLines(newText));
}

function evaluateDiffSize(toolName: string, input: Record<string, unknown>, maxDiffLines: number): PolicyDecision {
  if (maxDiffLines <= 0) return { block: false }; // 0 or negative = no limit
  if (!["write", "edit", "str_replace"].includes(toolName)) return { block: false };

  let totalChangedLines = 0;

  if (toolName === "write") {
    const content = input.content;
    if (typeof content === "string") {
      totalChangedLines = countLines(content);
    }
  } else {
    const edits = input.edits;
    const replacements = input.replacements;

    if (Array.isArray(edits)) {
      for (const entry of edits) totalChangedLines += editSizeFromEntry(entry);
    } else if (Array.isArray(replacements)) {
      for (const entry of replacements) totalChangedLines += editSizeFromEntry(entry);
    } else {
      totalChangedLines = editSizeFromEntry(input);
    }
  }

  if (totalChangedLines > maxDiffLines) {
    return {
      block: true,
      reason: `Autoresearch policy: diff too large (${totalChangedLines} lines, max ${maxDiffLines}). Wijs kleine, incrementele wijzigingen toe.`,
    };
  }

  return { block: false };
}

export function buildSecurityAuditEntry(toolName: string, input: Record<string, unknown>, reason: string): SecurityAuditEntry {
  const entry: SecurityAuditEntry = {
    type: "security_block",
    timestamp: new Date().toISOString(),
    tool: toolName,
    reason,
  };

  if (typeof input.path === "string" && input.path.trim()) {
    entry.path = redactPathForAudit(input.path);
  }

  if (typeof input.command === "string" && input.command.trim()) {
    entry.commandPreview = previewCommand(input.command);
  }

  const keys = Object.keys(input)
    .filter(key => !["path", "command", "content", "edits", "replacements", "old", "oldText", "old_str", "new", "newText", "new_str"].includes(key))
    .sort();
  if (keys.length > 0) entry.inputKeys = keys.slice(0, 10);

  return entry;
}

export function evaluateToolCall(toolName: string, input: Record<string, unknown>, cwd: string, contract = readContract(cwd), maxDiffLines = 50): PolicyDecision {
  if (toolName === "bash") {
    const command = input.command;
    if (typeof command !== "string") return { block: true, reason: "Autoresearch policy: bash command is missing." };
    return evaluateBashCommand(command);
  }

  if (toolName === "write" || toolName === "edit" || toolName === "str_replace") {
    const pathDecision = evaluatePathMutation(cwd, input.path, contract);
    if (pathDecision.block) return pathDecision;
    const sizeDecision = evaluateDiffSize(toolName, input, maxDiffLines);
    if (sizeDecision.block) return sizeDecision;
  }

  return { block: false };
}

export function hasAutoresearchSession(cwd: string): boolean {
  const p = paths(cwd);
  return fs.existsSync(p.context) || fs.existsSync(p.jsonl);
}
