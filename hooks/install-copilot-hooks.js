#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, resolveTargetDir, runHookOpsMain } = require("./lib/hook/hook-ops");
const { HOOK_FILES: hookFiles } = require("./lib/hook/constants");

const repoRoot = path.resolve(__dirname, "..");
const defaultSourceDir = path.join(repoRoot, ".github", "hooks");
const HOOK_SCRIPT_NAMES = {
  "session-start.json": "session-start.js",
  "user-prompt-submit.json": "user-prompt-submit.js",
  "post-tool-use.json": "post-tool-use.js",
  "pre-compact.json": "pre-compact.js",
  "stop.json": "session-end.js",
  "session-end.json": "session-end.js",
};
const HOOK_DEFINITIONS = {
  "session-start.json": {
    hooks: {
      SessionStart: [
        {
          type: "command",
          command: "PLACEHOLDER",
          timeout: 10,
        },
      ],
    },
  },
  "user-prompt-submit.json": {
    hooks: {
      UserPromptSubmit: [
        {
          type: "command",
          command: "PLACEHOLDER",
          timeout: 5,
        },
      ],
    },
  },
  "post-tool-use.json": {
    hooks: {
      PostToolUse: [
        {
          type: "command",
          command: "PLACEHOLDER",
          timeout: 5,
        },
      ],
    },
  },
  "pre-compact.json": {
    hooks: {
      PreCompact: [
        {
          type: "command",
          command: "PLACEHOLDER",
          timeout: 15,
        },
      ],
    },
  },
  "stop.json": {
    hooks: {
      Stop: [
        {
          type: "command",
          command: "PLACEHOLDER",
          timeout: 15,
        },
      ],
    },
  },
  "session-end.json": {
    hooks: {
      SessionEnd: [
        {
          type: "command",
          command: "PLACEHOLDER",
          timeout: 15,
        },
      ],
    },
  },
};

function resolveSourceDir(runtime = {}) {
  if (typeof runtime.sourceDir === "string" && runtime.sourceDir !== "") {
    return runtime.sourceDir;
  }

  return defaultSourceDir;
}

function readSourceHookFile(fileName, sourceDir) {
  if (typeof sourceDir !== "string" || sourceDir === "") {
    return null;
  }

  const sourcePath = path.join(sourceDir, fileName);
  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
}

function buildInlineHookFile(fileName) {
  const definition = HOOK_DEFINITIONS[fileName];
  if (typeof definition === "undefined") {
    throw new Error(`missing inline hook definition for ${fileName}`);
  }

  return JSON.parse(JSON.stringify(definition));
}

function buildHookDocument(fileName, runtime = {}) {
  const sourceDir = resolveSourceDir(runtime);
  const sourceDefinition = readSourceHookFile(fileName, sourceDir);
  return sourceDefinition !== null ? sourceDefinition : buildInlineHookFile(fileName);
}

function rewriteCommand(command, hookRoot, hookScriptName) {
  const directCommand = `node "${hookRoot}/${hookScriptName}"`;
  return command === "PLACEHOLDER"
    ? directCommand
    : command.replace(/^node hooks\/(.+)$/u, `node "${hookRoot}/$1"`);
}

function rewriteEntry(entry, hookRoot, hookScriptName) {
  if (entry === null || typeof entry !== "object") {
    return entry;
  }

  const rewrittenCommand =
    typeof entry.command === "string"
      ? rewriteCommand(entry.command, hookRoot, hookScriptName)
      : entry.command;
  const rewrittenHooks = Array.isArray(entry.hooks)
    ? entry.hooks.map((childEntry) => rewriteEntry(childEntry, hookRoot, hookScriptName))
    : entry.hooks;

  return {
    ...entry,
    ...(typeof entry.command === "string" ? { command: rewrittenCommand } : {}),
    ...(Array.isArray(entry.hooks) ? { hooks: rewrittenHooks } : {}),
  };
}

function rewriteHookFile(fileName, hookRoot, runtime = {}) {
  const hookScriptName = HOOK_SCRIPT_NAMES[fileName];
  if (typeof hookScriptName !== "string") {
    throw new Error(`missing hook script mapping for ${fileName}`);
  }

  const parsed = buildHookDocument(fileName, runtime);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid hook file shape for ${fileName}`);
  }

  if (parsed.hooks === null || typeof parsed.hooks !== "object" || Array.isArray(parsed.hooks)) {
    throw new Error(`invalid hooks object for ${fileName}`);
  }

  const nextHooks = Object.fromEntries(
    Object.entries(parsed.hooks).map(([eventName, entries]) => [
      eventName,
      Array.isArray(entries)
        ? entries.map((entry) => rewriteEntry(entry, hookRoot, hookScriptName))
        : entries,
    ]),
  );

  const nextDocument = {
    ...parsed,
    hooks: nextHooks,
  };

  return `${JSON.stringify(nextDocument, null, 2)}\n`;
}

function buildHookWriteOperation(fileName, targetDir, hookRoot, runtime = {}) {
  return {
    targetPath: path.join(targetDir, fileName),
    content: rewriteHookFile(fileName, hookRoot, runtime),
  };
}

function buildHookWriteOperations(targetDir, hookRoot, runtime = {}) {
  return hookFiles.map((fileName) =>
    buildHookWriteOperation(fileName, targetDir, hookRoot, runtime),
  );
}

function run(runtime = {}) {
  const targetDir = resolveTargetDir(runtime);
  const hookRoot = path.join(repoRoot, "hooks").replace(/\\/g, "/");

  fs.mkdirSync(targetDir, { recursive: true });
  const operations = buildHookWriteOperations(targetDir, hookRoot, runtime);
  operations.forEach((operation) => {
    fs.writeFileSync(operation.targetPath, operation.content, "utf-8");
  });

  return {
    status: 0,
    stdout: `Installed Memory Mason Copilot hooks to ${targetDir}\n`,
    stderr: "",
  };
}

function main(runtime = {}) {
  return runHookOpsMain(runtime, run);
}

module.exports = {
  parseArgs,
  resolveTargetDir,
  resolveSourceDir,
  readSourceHookFile,
  buildInlineHookFile,
  buildHookDocument,
  rewriteEntry,
  rewriteHookFile,
  run,
  main,
};

/* c8 ignore next 3 */
if (require.main === module) {
  main();
}
