#!/usr/bin/env node

/**
 * Autoresearch Comparison Benchmark
 *
 * Compares the Pi autoresearch implementation with Factory.ai's droid autoresearch
 * across multiple dimensions: features, performance, usability, and integration.
 *
 * Usage: node scripts/benchmark-comparison.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");

// Comparison criteria based on autoresearch system analysis
const comparisonCriteria = {
  // Core functionality
  experimentLoop: {
    weight: 10,
    description: "Autonomous experiment loop with keep/discard decisions",
  },
  stateManagement: {
    weight: 8,
    description: "Crash-safe state management and resume capability",
  },
  confidenceScoring: {
    weight: 7,
    description: "Statistical confidence scoring for improvements",
  },
  gitIsolation: {
    weight: 8,
    description: "Git branch isolation for experiments",
  },

  // Safety features
  correctnessGuards: {
    weight: 9,
    description: "Correctness guards (tests, type checking)",
  },
  safetyPolicy: {
    weight: 8,
    description: "Safety policy for destructive operations",
  },
  scopeValidation: {
    weight: 7,
    description: "Files in scope and off-limits validation",
  },

  // User experience
  uiIntegration: {
    weight: 6,
    description: "Terminal UI integration and progress display",
  },
  commands: {
    weight: 5,
    description: "Command-line interface and slash commands",
  },
  documentation: {
    weight: 5,
    description: "Comprehensive documentation and examples",
  },

  // Extensibility
  toolIntegration: {
    weight: 7,
    description: "Integration with agent tools and capabilities",
  },
  customMetrics: {
    weight: 6,
    description: "Support for custom metrics and multi-objective optimization",
  },
  pluginSystem: {
    weight: 5,
    description: "Plugin/skill system for extensions",
  },

  // Performance
  throughput: {
    weight: 7,
    description: "Experiment throughput (experiments per hour)",
  },
  resourceEfficiency: {
    weight: 6,
    description: "Resource efficiency and overhead",
  },
};

// System implementations
const implementations = {
  piAutoresearch: {
    name: "Pi Autoresearch",
    description: "TypeScript-based Pi extension for autoresearch workflows",
    features: {
      experimentLoop: true,
      stateManagement: true,
      confidenceScoring: true, // MAD-based
      gitIsolation: true,
      correctnessGuards: true,
      safetyPolicy: true,
      scopeValidation: true,
      uiIntegration: true, // Pi TUI
      commands: true, // Pi slash commands
      documentation: true,
      toolIntegration: true, // Pi tools
      customMetrics: true,
      pluginSystem: true, // Pi skills
      throughput: "high", // TypeScript performance
      resourceEfficiency: "medium", // Node.js overhead
    },
  },
  droidAutoresearch: {
    name: "Droid Autoresearch (Factory.ai)",
    description: "Python-based skill for Factory.ai droid CLI",
    features: {
      experimentLoop: true,
      stateManagement: true,
      confidenceScoring: true, // MAD-based
      gitIsolation: true,
      correctnessGuards: true, // Optional checks script
      safetyPolicy: false, // Relies on droid's safety
      scopeValidation: true,
      uiIntegration: false, // Terminal output only
      commands: true, // Droid skill invocation
      documentation: true,
      toolIntegration: true, // Droid tools
      customMetrics: true,
      pluginSystem: true, // Droid skills/plugins
      throughput: "high", // Python performance
      resourceEfficiency: "high", // Lightweight Python
    },
  },
};

function scoreFeature(value, criterion) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    // Performance metrics
    const scores = { high: 1, medium: 0.7, low: 0.4 };
    return scores[value] || 0.5;
  }
  return 0.5; // Default partial score
}

function calculateScores(implementation) {
  let totalScore = 0;
  let maxScore = 0;
  const scores = {};

  for (const [key, criterion] of Object.entries(comparisonCriteria)) {
    const featureValue = implementation.features[key];
    const featureScore = scoreFeature(featureValue, criterion);
    scores[key] = {
      score: featureScore,
      weight: criterion.weight,
      weighted: featureScore * criterion.weight,
      description: criterion.description,
      value: featureValue,
    };
    totalScore += featureScore * criterion.weight;
    maxScore += criterion.weight;
  }

  return { totalScore, maxScore, scores };
}

function formatScore(score, max) {
  const percentage = (score / max) * 100;
  return `${score.toFixed(1)}/${max.toFixed(1)} (${percentage.toFixed(1)}%)`;
}

function printComparison() {
  console.log("# Autoresearch System Comparison");
  console.log(`# Timestamp: ${new Date().toISOString()}`);
  console.log();

  // Calculate scores for each implementation
  const piScores = calculateScores(implementations.piAutoresearch);
  const droidScores = calculateScores(implementations.droidAutoresearch);

  // Print overview
  console.log("## Overview");
  console.log();
  console.log("### Pi Autoresearch");
  console.log(implementations.piAutoresearch.description);
  console.log(`Overall Score: ${formatScore(piScores.totalScore, piScores.maxScore)}`);
  console.log();

  console.log("### Droid Autoresearch (Factory.ai)");
  console.log(implementations.droidAutoresearch.description);
  console.log(`Overall Score: ${formatScore(droidScores.totalScore, droidScores.maxScore)}`);
  console.log();

  // Print detailed comparison
  console.log("## Detailed Comparison");
  console.log();
  console.log("| Criterion | Weight | Pi | Droid | Pi Score | Droid Score |");
  console.log("|-----------|--------|-----|-------|----------|-------------|");

  for (const [key, criterion] of Object.entries(comparisonCriteria)) {
    const piScore = piScores.scores[key];
    const droidScore = droidScores.scores[key];

    const piValue =
      typeof piScore.value === "boolean" ? (piScore.value ? "✓" : "✗") : piScore.value;
    const droidValue =
      typeof droidScore.value === "boolean" ? (droidScore.value ? "✓" : "✗") : droidScore.value;

    console.log(
      `| ${criterion.description} | ${criterion.weight} | ${piValue} | ${droidValue} | ${piScore.weighted.toFixed(1)} | ${droidScore.weighted.toFixed(1)} |`
    );
  }
  console.log();

  // Print summary metrics
  console.log("## Summary Metrics");
  console.log();
  const piPercentage = (piScores.totalScore / piScores.maxScore) * 100;
  const droidPercentage = (droidScores.totalScore / droidScores.maxScore) * 100;

  console.log(`METRIC pi_overall_score=${piScores.totalScore.toFixed(2)} direction=higher`);
  console.log(`METRIC pi_overall_percentage=${piPercentage.toFixed(2)} direction=higher`);
  console.log(`METRIC droid_overall_score=${droidScores.totalScore.toFixed(2)} direction=higher`);
  console.log(`METRIC droid_overall_percentage=${droidPercentage.toFixed(2)} direction=higher`);
  console.log(
    `METRIC score_difference=${(piScores.totalScore - droidScores.totalScore).toFixed(2)} direction=neutral`
  );
  console.log();

  // Print feature analysis
  console.log("## Feature Analysis");
  console.log();

  const piAdvantages = [];
  const droidAdvantages = [];
  const ties = [];

  for (const [key, criterion] of Object.entries(comparisonCriteria)) {
    const piScore = piScores.scores[key].weighted;
    const droidScore = droidScores.scores[key].weighted;

    if (Math.abs(piScore - droidScore) < 0.1) {
      ties.push(criterion.description);
    } else if (piScore > droidScore) {
      piAdvantages.push(criterion.description);
    } else {
      droidAdvantages.push(criterion.description);
    }
  }

  console.log("### Pi Autoresearch Advantages");
  if (piAdvantages.length > 0) {
    piAdvantages.forEach((adv) => console.log(`- ${adv}`));
  } else {
    console.log("(none)");
  }
  console.log();

  console.log("### Droid Autoresearch Advantages");
  if (droidAdvantages.length > 0) {
    droidAdvantages.forEach((adv) => console.log(`- ${adv}`));
  } else {
    console.log("(none)");
  }
  console.log();

  console.log("### Tied Features");
  if (ties.length > 0) {
    ties.forEach((tie) => console.log(`- ${tie}`));
  } else {
    console.log("(none)");
  }
  console.log();

  // Print recommendations
  console.log("## Recommendations");
  console.log();
  console.log("### When to use Pi Autoresearch");
  console.log("- You need deep Pi TUI integration");
  console.log("- You prefer TypeScript for tool development");
  console.log("- You require advanced safety policies and scope validation");
  console.log("- You want rich terminal UI with progress tracking");
  console.log("- You're building on the Pi agent platform");
  console.log();

  console.log("### When to use Droid Autoresearch");
  console.log("- You're using Factory.ai's droid CLI");
  console.log("- You prefer Python for helper scripts");
  console.log("- You need lightweight resource efficiency");
  console.log("- You want simple skill-based integration");
  console.log("- You're building on the Factory.ai platform");
  console.log();

  console.log("## Conclusion");
  console.log();
  if (piScores.totalScore > droidScores.totalScore) {
    console.log(
      `Pi Autoresearch scores higher overall (${formatScore(piScores.totalScore, piScores.maxScore)} vs ${formatScore(droidScores.totalScore, droidScores.maxScore)})`
    );
    console.log("due to stronger UI integration and safety features.");
  } else if (droidScores.totalScore > piScores.totalScore) {
    console.log(
      `Droid Autoresearch scores higher overall (${formatScore(droidScores.totalScore, droidScores.maxScore)} vs ${formatScore(piScores.totalScore, piScores.maxScore)})`
    );
    console.log("due to better resource efficiency and simplicity.");
  } else {
    console.log("Both systems score equally overall.");
    console.log(
      "The choice depends on your platform (Pi vs Factory.ai) and specific requirements."
    );
  }
  console.log();
}

// Run the comparison
printComparison();
