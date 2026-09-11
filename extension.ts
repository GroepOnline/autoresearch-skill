/**
 * Backwards-compatible package entrypoint.
 *
 * The canonical implementation lives in extensions/autoresearch/. Keeping this
 * shim avoids a second runtime implementation drifting from the bounded policy,
 * state layout, commands and safety guards used by the Pi package manifest.
 */
export { default } from "./extensions/autoresearch/index.js";
