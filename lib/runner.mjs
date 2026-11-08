/**
 * @deprecated Compatibility entry point.
 *
 * Autoresearch orchestration is owned by the Pi extension in
 * `extensions/autoresearch/`. Keeping a second implementation here would
 * bypass the extension's policy, state, and stop-condition guards.
 */

export async function run() {
  throw new Error(
    "The standalone runner has been removed. Load extensions/autoresearch/index.ts and use /autoresearch start or /autoresearch ralph."
  );
}
