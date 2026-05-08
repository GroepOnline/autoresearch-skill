/**
 * Simple structured logger for autoresearch extension.
 * Logs to stderr with timestamp and context information.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

// Minimum log level (can be overridden via AUTORESEARCH_LOG_LEVEL env var)
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  const env = process.env.AUTORESEARCH_LOG_LEVEL?.toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") {
    return env;
  }
  return "info"; // Default to info
}

function shouldLog(level: LogLevel): boolean {
  const minLevel = getMinLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function formatEntry(entry: LogEntry): string {
  const { timestamp, level, message, context } = entry;
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (context && Object.keys(context).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(context)}`;
  }
  return `${prefix} ${message}`;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Remove absolute paths from error messages to avoid leaking sensitive info
    return error.message.replace(/\/[^\s]+/g, "[path]");
  }
  return String(error);
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string") {
      // Remove absolute paths
      sanitized[key] = value.replace(/\/[^\s]+/g, "[path]");
    } else if (value instanceof Error) {
      sanitized[key] = sanitizeError(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: context ? sanitizeContext(context) : undefined,
  };

  // Log to stderr to avoid interfering with stdout
  console.error(formatEntry(entry));
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),

  // Convenience method for catching and logging errors
  catch: (operation: string, error: unknown, context?: Record<string, unknown>): void => {
    logger.error(`${operation} failed`, {
      error: sanitizeError(error),
      ...context,
    });
  },
};
