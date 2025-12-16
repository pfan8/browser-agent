/**
 * Build script using esbuild
 * Avoids TypeScript memory issues with large type definitions
 *
 * Usage:
 *   node build.mjs          # Fast build (skip type declarations)
 *   node build.mjs --types  # Full build with type declarations
 */

import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const srcDir = "./src";
const outDir = "./dist";
const generateTypes = process.argv.includes("--types");

// #region agent log
import { appendFileSync } from "fs";
const LOG_PATH =
  "/Users/roland.wang/repos/browser-agent/chat-agent/.cursor/debug.log";
const debugLog = (msg, data) => {
  try {
    appendFileSync(
      LOG_PATH,
      JSON.stringify({
        location: "build.mjs",
        message: msg,
        data,
        timestamp: Date.now(),
        hypothesisId: "A",
      }) + "\n"
    );
  } catch (e) {}
};
debugLog("build.mjs started", {
  argv: process.argv,
  generateTypes,
  cwd: process.cwd(),
});
// #endregion

// Ensure output directory exists
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Find all TypeScript files
function findTsFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTsFiles(fullPath, files);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const entryPoints = findTsFiles(srcDir);

// Build with esbuild
await esbuild.build({
  entryPoints,
  outdir: outDir,
  bundle: false,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
});

console.log("JavaScript build complete!");

// Generate type declarations using tsc (only with --types flag)
// #region agent log
debugLog("type generation check", {
  generateTypes,
  willGenerate: generateTypes,
});
// #endregion
if (generateTypes) {
  // #region agent log
  debugLog("entering type generation branch", {});
  // #endregion
  console.log("Generating type declarations...");
  try {
    execSync("npx tsc --declaration --emitDeclarationOnly --outDir dist", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    console.log("Type declarations generated!");
  } catch (e) {
    console.warn(
      "Warning: Type declaration generation failed, continuing without types"
    );
  }
} else {
  // #region agent log
  debugLog("skipping type generation branch", {});
  // #endregion
  console.log("Skipping type declarations (use --types to generate)");
}

console.log("Build complete!");
