/**
 * @module scorer
 * Pure scoring logic for SKILL.md quality assessment.
 *
 * Scores a skill file content string on a 0-100 scale based on:
 * - Frontmatter fields (name, description)
 * - Rules section depth
 * - Examples section depth
 * - Commands section depth
 *
 * NO I/O, NO temp files — pure function only.
 */

/**
 * @typedef {Object} ScoreResult
 * @property {number} score - Quality score 0-100
 * @property {Object} breakdown - Per-category scores
 * @property {number} breakdown.frontmatter - Score for name/description fields (0-20)
 * @property {number} breakdown.rules - Score for Rules section (0-30)
 * @property {number} breakdown.examples - Score for Examples section (0-25)
 * @property {number} breakdown.commands - Score for Commands section (0-25)
 */

/**
 * Score a SKILL.md content string. Pure function — no I/O.
 *
 * @param {string} content - The full text content of a SKILL.md file
 * @returns {ScoreResult} Score object with total and breakdown
 */
export function scoreContent(content) {
  let total = 0;
  const breakdown = { frontmatter: 0, rules: 0, examples: 0, commands: 0 };

  // Frontmatter fields (max 20)
  if (/^name:/m.test(content)) {
    breakdown.frontmatter += 10;
    total += 10;
  }
  if (/^description:/m.test(content)) {
    breakdown.frontmatter += 10;
    total += 10;
  }

  // Rules section (max 30)
  const rulesMatch = content.match(/## Rules[\s\S]*?(?=##|$)/);
  if (rulesMatch) {
    breakdown.rules += 10;
    total += 10;
    const ruleLines = rulesMatch[0].split("\n").filter((l) => /^[-*]\s|^\d+\.\s/.test(l.trim()));
    const ruleScore = Math.min(20, ruleLines.length * 4);
    breakdown.rules += ruleScore;
    total += ruleScore;
  }

  // Examples section (max 25)
  const examplesMatch = content.match(/## Examples?[\s\S]*?(?=##|$)/);
  if (examplesMatch) {
    breakdown.examples += 10;
    total += 10;
    const exLines = examplesMatch[0].split("\n").filter((l) => l.trim().length > 5);
    const exScore = Math.min(15, exLines.length * 3);
    breakdown.examples += exScore;
    total += exScore;
  }

  // Commands section (max 25)
  const commandsMatch = content.match(/## Commands?[\s\S]*?(?=##|$)/);
  if (commandsMatch) {
    breakdown.commands += 10;
    total += 10;
    const cmdLines = commandsMatch[0].split("\n").filter((l) => /^[-*\d]/.test(l.trim()));
    const cmdScore = Math.min(15, cmdLines.length * 3);
    breakdown.commands += cmdScore;
    total += cmdScore;
  }

  return { score: total, breakdown };
}
