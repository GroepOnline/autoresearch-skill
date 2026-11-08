import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { paths, readState } from "../extensions/autoresearch/state.js";

function tempProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-autoresearch-test-"));
  mkdirSync(paths(cwd).dir, { recursive: true });
  return cwd;
}

test("archiveArtifacts creates timestamped archive", async () => {
  const cwd = tempProject();
  const p = paths(cwd);

  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.jsonl, '{"type":"config"}\n');
  writeFileSync(p.context, "# Test\n");

  const { archiveArtifacts } = await import("../extensions/autoresearch/commands.js");

  const archivePath = archiveArtifacts(cwd, p.dir);

  // Verify archive was created
  assert.ok(existsSync(archivePath));
  assert.ok(existsSync(join(archivePath, "autoresearch.jsonl")));
  assert.ok(existsSync(join(archivePath, "autoresearch.md")));

  // Verify original files are gone
  assert.ok(!existsSync(p.jsonl));
  assert.ok(!existsSync(p.context));
});

test("archiveArtifacts creates timestamped archive with correct format", async () => {
  const cwd = tempProject();
  const p = paths(cwd);

  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.jsonl, '{"type":"config"}\n');
  writeFileSync(p.context, "# Test\n");

  const { archiveArtifacts } = await import("../extensions/autoresearch/commands.js");

  const archivePath = archiveArtifacts(cwd, p.dir);

  // Archive path should be in experiments/archive/ with timestamp (colons replaced with dashes)
  assert.match(
    archivePath.replaceAll("\\", "/"),
    /experiments\/archive\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/
  );

  // Verify content is preserved
  const archivedJsonl = readFileSync(join(archivePath, "autoresearch.jsonl"), "utf-8");
  assert.equal(archivedJsonl, '{"type":"config"}\n');

  const archivedContext = readFileSync(join(archivePath, "autoresearch.md"), "utf-8");
  assert.equal(archivedContext, "# Test\n");
});

test("archiveArtifacts moves all artifact files", async () => {
  const cwd = tempProject();
  const p = paths(cwd);

  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.jsonl, '{"type":"config"}\n');
  writeFileSync(p.context, "# Test\n");
  writeFileSync(p.benchmark, "#!/bin/bash\necho test\n");
  writeFileSync(p.worklog, "# Worklog\n");
  writeFileSync(p.dashboard, "# Dashboard\n");
  writeFileSync(p.ideas, "# Ideas\n");
  writeFileSync(p.sentinel, "paused\n");

  const { archiveArtifacts } = await import("../extensions/autoresearch/commands.js");

  const archivePath = archiveArtifacts(cwd, p.dir);

  // All files should be moved
  assert.ok(existsSync(join(archivePath, "autoresearch.jsonl")));
  assert.ok(existsSync(join(archivePath, "autoresearch.md")));
  assert.ok(existsSync(join(archivePath, "autoresearch.sh")));
  assert.ok(existsSync(join(archivePath, "worklog.md")));
  assert.ok(existsSync(join(archivePath, "autoresearch-dashboard.md")));
  assert.ok(existsSync(join(archivePath, "autoresearch.ideas.md")));
  assert.ok(existsSync(join(archivePath, ".autoresearch-off")));

  // Original directory should be empty (or removed)
  assert.ok(!existsSync(p.jsonl));
  assert.ok(!existsSync(p.context));
});
