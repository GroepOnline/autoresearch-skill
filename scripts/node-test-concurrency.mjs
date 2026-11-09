/**
 * Whether a Node.js release supports the --test-concurrency CLI option.
 *
 * Node added the option in v18.19.0, v20.10.0, and v21.0.0.
 */
export function supportsTestConcurrency(version) {
  const [major, minor] = version.split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;

  return major >= 21 || (major === 20 && minor >= 10) || (major === 18 && minor >= 19);
}
