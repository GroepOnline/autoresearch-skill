/**
 * @module validator
 * SKILL.md validation logic.
 *
 * Ported from skill-grinder/quick_validate.py to JavaScript.
 * Checks:
 * - YAML frontmatter presence and required fields (name, description)
 * - Local reference links resolve to existing files
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {Object} ValidationResult
 * @property {string} skillDir - The skill directory path
 * @property {string[]} errors - List of validation errors (empty = valid)
 * @property {boolean} valid - True if no errors
 */

/**
 * Validate a single skill directory's SKILL.md content.
 *
 * @param {string} content - The full text content of SKILL.md
 * @param {string} skillDir - Absolute path to the skill directory (for resolving reference links)
 * @returns {ValidationResult}
 */
export function validateSkillContent(content, skillDir) {
  const errors = [];

  // 1. Parse Frontmatter
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!frontmatterMatch) {
    errors.push(
      "Missing or invalid YAML frontmatter (must start and end with '---')"
    );
  } else {
    const frontmatterText = frontmatterMatch[1];
    // Check name
    if (!/^name:\s*(\S+)/m.test(frontmatterText)) {
      errors.push("Frontmatter is missing 'name' field");
    }
    // Check description
    if (!/^description:\s*(.+)/m.test(frontmatterText)) {
      errors.push("Frontmatter is missing 'description' field");
    }
  }

  // 2. Check local reference links
  // Look for [link text](references/file.md) or similar patterns
  const localLinkPattern = /\[([^\]]+)\]\((\.\/)?(references\/[^)]+)\)/g;
  let match;
  while ((match = localLinkPattern.exec(content)) !== null) {
    const linkText = match[1];
    const linkPath = match[3];

    // Build full path, strip anchors like #L123 or #header
    let fullRefPath = join(skillDir, linkPath);
    if (fullRefPath.includes("#")) {
      fullRefPath = fullRefPath.split("#")[0];
    }

    if (!existsSync(fullRefPath)) {
      errors.push(
        `Broken reference: '${linkPath}' (linked as '${linkText}') does not exist`
      );
    }
  }

  return {
    skillDir,
    errors,
    valid: errors.length === 0,
  };
}
