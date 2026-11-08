import assert from "node:assert/strict";
import test from "node:test";
import { logger } from "../extensions/autoresearch/logger.js";

function captureStderr(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test("logger defaults to warn and suppresses info", () => {
  const previous = process.env.AUTORESEARCH_LOG_LEVEL;
  delete process.env.AUTORESEARCH_LOG_LEVEL;

  const lines = captureStderr(() => {
    logger.info("hidden");
    logger.warn("visible");
  });

  if (previous === undefined) {
    delete process.env.AUTORESEARCH_LOG_LEVEL;
  } else {
    process.env.AUTORESEARCH_LOG_LEVEL = previous;
  }

  assert.equal(lines.length, 1);
  assert.match(lines[0], /visible/);
});

test("logger sanitizes Windows and POSIX paths recursively", () => {
  const previous = process.env.AUTORESEARCH_LOG_LEVEL;
  process.env.AUTORESEARCH_LOG_LEVEL = "warn";

  const lines = captureStderr(() => {
    logger.warn("paths", {
      cwd: "C:\\Users\\Joep\\secret\\project",
      nested: { file: "/home/joep/secret.txt" },
      list: ["D:\\keys\\id_rsa", "/tmp/token"],
    });
  });

  if (previous === undefined) {
    delete process.env.AUTORESEARCH_LOG_LEVEL;
  } else {
    process.env.AUTORESEARCH_LOG_LEVEL = previous;
  }

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /Joep|secret|id_rsa|token/);
  assert.match(lines[0], /\[path\]/);
});
