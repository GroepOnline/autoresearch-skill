import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "extension.ts"), "utf-8");

test("root extension stays a thin compatibility shim", () => {
  assert.match(source, /export \{ default \} from "\.\/extensions\/autoresearch\/index\.js"/);
  assert.doesNotMatch(source, /LOOP FOREVER|NEVER STOP/);
  assert.ok(source.split("\n").length < 20, "root extension must not become a second implementation");
});
