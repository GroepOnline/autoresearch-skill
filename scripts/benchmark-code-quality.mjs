#!/usr/bin/env node

/**
 * Code Quality Benchmark Script
 *
 * Measures various code quality metrics for the autoresearch skill:
 * - TypeScript compilation time
 * - Test execution time
 * - Code size metrics
 * - File counts
 * - Test coverage
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");

function measureTime(label, fn) {
  const start = performance.now();
  fn();
  const end = performance.now();
  const duration = (end - start).toFixed(2);
  console.log(`METRIC ${label}_ms=${duration} direction=lower`);
  return duration;
}

function countLines(filePath) {
  const content = readFileSync(filePath, "utf-8");
  return content.split("\n").length;
}

function countTypeScriptFiles(dir) {
  let count = 0;
  let totalLines = 0;

  function traverse(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and .git
        if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist") {
          traverse(fullPath);
        }
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        count++;
        totalLines += countLines(fullPath);
      }
    }
  }

  traverse(dir);
  return { count, totalLines };
}

function countTestFiles(dir) {
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      count++;
    }
  }
  return count;
}

function getPackageSize() {
  try {
    const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    const dependencies = Object.keys(packageJson.dependencies || {}).length;
    const devDependencies = Object.keys(packageJson.devDependencies || {}).length;
    return { dependencies, devDependencies };
  } catch {
    return { dependencies: 0, devDependencies: 0 };
  }
}

console.log("# Code Quality Benchmark");
console.log(`# Timestamp: ${new Date().toISOString()}`);
console.log();

// Measure TypeScript compilation time
console.log("## TypeScript Compilation");
try {
  measureTime("tsc_compile", () => {
    execSync("npm run typecheck", { cwd: rootDir, stdio: "pipe" });
  });
  console.log("METRIC tsc_success=1 direction=higher");
} catch (error) {
  console.log("METRIC tsc_success=0 direction=higher");
  console.error("TypeScript compilation failed:", error.message);
}
console.log();

// Measure test execution time
console.log("## Test Execution");
try {
  measureTime("test_execution", () => {
    execSync("npm test", { cwd: rootDir, stdio: "pipe" });
  });
  console.log("METRIC test_success=1 direction=higher");
} catch (error) {
  console.log("METRIC test_success=0 direction=higher");
  console.error("Tests failed:", error.message);
}
console.log();

// Measure test execution time for TypeScript tests
console.log("## TypeScript Test Execution");
try {
  measureTime("test_ts_execution", () => {
    execSync("npm run test:ts", { cwd: rootDir, stdio: "pipe" });
  });
  console.log("METRIC test_ts_success=1 direction=higher");
} catch (error) {
  console.log("METRIC test_ts_success=0 direction=higher");
  console.error("TypeScript tests failed:", error.message);
}
console.log();

// Code size metrics
console.log("## Code Size Metrics");
const tsMetrics = countTypeScriptFiles(rootDir);
console.log(`METRIC ts_files=${tsMetrics.count} direction=neutral`);
console.log(`METRIC ts_lines=${tsMetrics.totalLines} direction=neutral`);

const testCount = countTestFiles(join(rootDir, "tests-ts"));
console.log(`METRIC test_files=${testCount} direction=higher`);

const packageSize = getPackageSize();
console.log(`METRIC dependencies=${packageSize.dependencies} direction=lower`);
console.log(`METRIC dev_dependencies=${packageSize.devDependencies} direction=lower`);
console.log();

console.log("## Summary");
console.log("Benchmark complete. All metrics printed above in METRIC format.");
