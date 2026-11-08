/**
 * @module skill-finder
 * Locate SKILL.md files in a target directory, with optional name filtering.
 */

import { execSync } from "node:child_process";

/**
 * Find all SKILL.md files under a target directory.
 * Excludes _imported, _archive, and _testing subdirectories.
 *
 * @param {string} targetDir - Root directory to search
 * @param {Object} [options]
 * @param {string|null} [options.filter] - Comma-separated skill names to filter by
 * @param {number} [options.limit=200] - Maximum number of files to return
 * @returns {string[]} Array of absolute paths to SKILL.md files
 */
export function getSkillFiles(targetDir, { filter = null, limit = 200 } = {}) {
  try {
    const result = execSync(
      `find "${targetDir}" -name "SKILL.md" -type f -not -path "*/_imported/*" -not -path "*/_archive/*" -not -path "*/_testing/*" | head -${limit}`,
      { encoding: "utf-8", timeout: 10000 }
    );
    let files = result.trim().split("\n").filter(Boolean);

    if (filter) {
      const names = filter.split(",").map((s) => s.trim().toLowerCase());
      files = files.filter((f) => {
        const dir = f
          .replace(/\/SKILL\.md$/, "")
          .split("/")
          .pop()
          .toLowerCase();
        return names.includes(dir);
      });
    }

    return files;
  } catch {
    return [];
  }
}
