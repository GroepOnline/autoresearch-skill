#!/usr/bin/env node
/**
 * @deprecated The standalone llama/Ollama loop was removed.
 *
 * Autoresearch control logic is centralized in the Pi extension at
 * `extensions/autoresearch/`, so policy, state persistence, and stop
 * conditions have one source of truth.
 */

console.error(
  "The standalone runner has been removed. Load extensions/autoresearch/index.ts and use /autoresearch start or /autoresearch ralph."
);
process.exitCode = 1;
