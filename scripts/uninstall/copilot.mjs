#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const hookOps = require("./lib/hook/hook-ops");
const hookConstants = require("./lib/hook/constants");

const hookFiles = hookConstants.HOOK_FILES;
const { parseArgs, resolveTargetDir, runHookOpsMain } = hookOps;

function buildHookPaths(targetDir) {
  return hookFiles.map((fileName) => require("node:path").join(targetDir, fileName));
}

function removeHookFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.rmSync(filePath, { force: true });
}

function removeHookFiles(filePaths) {
  filePaths.forEach((filePath) => {
    removeHookFile(filePath);
  });
}

function run(runtime = {}) {
  const targetDir = resolveTargetDir(runtime);
  const filePaths = buildHookPaths(targetDir);
  removeHookFiles(filePaths);

  return {
    status: 0,
    stdout: `Removed Memory Mason Copilot hooks from ${targetDir}\n`,
    stderr: "",
  };
}

function main(runtime = {}) {
  return runHookOpsMain(runtime, run);
}

/* c8 ignore next 3 */
if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  resolveTargetDir,
  removeHookFile,
  removeHookFiles,
  run,
  main,
};
