/**
 * @module analyzer
 * Skill analysis: combines validator + scorer to find issues in a SKILL.md file.
 *
 * Reads the file content, validates structure, scores quality,
 * and returns a list of actionable issues.
 */

import { readFileSync } from "node:fs";
import { scoreContent } from "./scorer.mjs";
import { validateSkillContent } from "./validator.mjs";

/**
 * @typedef {Object} AnalysisResult
 * @property {string} filePath - Absolute path to the SKILL.md file
 * @property {string} content - Full file content
 * @property {string[]} issues - List of human-readable issues found
 * @property {boolean} hasIssues - True if any issues were found
 * @property {number} score - Quality score (0-100)
 */

/**
 * Analyze a single SKILL.md file for issues.
 *
 * @param {string} filePath - Absolute path to the SKILL.md file
 * @param {Object} [options]
 * @param {number} [options.scoreThreshold=85] - Score below this triggers a "low quality" issue
 * @param {number} [options.minChars=200] - Minimum content length
 * @param {number} [options.maxChars=10000] - Maximum content length
 * @returns {AnalysisResult}
 */
export function analyzeSkill(filePath, options = {}) {
  const { scoreThreshold = 85, minChars = 200, maxChars = 10000 } = options;

  const content = readFileSync(filePath, "utf-8");
  const issues = [];

  // Structural checks
  if (!/^name:/m.test(content)) issues.push("Missing 'name' field in frontmatter");
  if (!/^description:/m.test(content)) issues.push("Missing 'description' field in frontmatter");
  if (!/## Rules/.test(content)) issues.push("Missing '## Rules' section");
  if (!/## Examples?/.test(content)) issues.push("Missing '## Examples' section");
  if (!/## Commands?/.test(content)) issues.push("Missing '## Commands' section");
  if (content.length < minChars) issues.push(`Skill file is too short (<${minChars} chars)`);
  if (content.length > maxChars) issues.push(`Skill file is too long (>${maxChars} chars)`);

  // Validation (frontmatter, reference links)
  const dirPath = filePath.replace(/\/SKILL\.md$/, "");
  const validation = validateSkillContent(content, dirPath);
  for (const err of validation.errors) {
    issues.push(err);
  }

  // Quality score check
  const { score } = scoreContent(content);
  if (score < scoreThreshold) {
    issues.push(`Low quality score: ${score}/100`);
  }

  return { filePath, content, issues, hasIssues: issues.length > 0, score };
}
