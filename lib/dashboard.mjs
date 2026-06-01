/**
 * @module dashboard
 * Generate a markdown dashboard summarizing autoresearch run results.
 */

import { writeFileSync } from "node:fs";

/**
 * @typedef {Object} DashboardStats
 * @property {number} runCount
 * @property {number} keptCount
 * @property {number} discardedCount
 * @property {number} crashedCount
 * @property {number|null} bestMetric
 * @property {number|null} bestRun
 * @property {number|null} baselineMetric
 * @property {Array<Object>} results - Recent results to display
 */

/**
 * Generate markdown dashboard content.
 *
 * @param {DashboardStats} stats
 * @returns {string} Markdown content for the dashboard
 */
export function generateDashboard(stats) {
  const {
    runCount,
    keptCount,
    discardedCount,
    crashedCount,
    bestMetric,
    bestRun,
    baselineMetric,
    results,
  } = stats;

  return `# Autoresearch Dashboard

| Metric | Value |
|--------|-------|
| Runs | ${runCount} |
| Kept | ${keptCount} |
| Discarded | ${discardedCount} |
| Crashed | ${crashedCount} |
| Best Metric | ${bestMetric ?? "N/A"} |
| Best Run | ${bestRun ?? "N/A"} |
| Baseline | ${baselineMetric ?? "N/A"} |

## Recent Runs

${results
  .slice(-10)
  .map((r) => `| ${r.run} | ${r.value} | ${r.status} | ${r.description} |`)
  .join("\n")}
`;
}

/**
 * Write the dashboard to a file.
 *
 * @param {string} dashboardPath - Absolute path to write the dashboard
 * @param {DashboardStats} stats
 * @param {boolean} [dryRun=false] - If true, log instead of writing
 */
export function saveDashboard(dashboardPath, stats, dryRun = false) {
  const dashboard = generateDashboard(stats);
  if (dryRun) {
    console.log(`\n[DRY RUN] Would save dashboard to: ${dashboardPath}`);
  } else {
    writeFileSync(dashboardPath, dashboard);
    console.log(`\nDashboard saved to: ${dashboardPath}`);
  }
}
