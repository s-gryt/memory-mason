/**
 * This module handles hook ops logic.
 */
"use strict";

const os = require("node:os");
const path = require("node:path");
const {
  chooseFirst,
  isNonNullObject,
  resolveIoHandlers,
  dispatchHookResult,
} = require("../hook/hook-runtime");

function isNonEmptyString(value) {
  return [String(value) === value, value !== ""].every(Boolean);
}

function reduceArgState(state, arg, index, args, safeCwd) {
  if (state.skipNext) {
    return {
      parsed: state.parsed,
      skipNext: false,
    };
  }

  if (arg === "--workspace" || arg === "-w") {
    const workspacePath = args[index + 1];
    if (typeof workspacePath !== "string" || workspacePath === "") {
      throw new Error(`${arg} requires a workspace path`);
    }

    return {
      parsed: {
        ...state.parsed,
        workspacePath: path.resolve(safeCwd, workspacePath),
      },
      skipNext: true,
    };
  }

  throw new Error(`unknown argument: ${arg}`);
}

function parseArgs(argv, cwd) {
  const safeArgv = Array.isArray(argv) ? argv : [];
  const safeCwd = typeof cwd === "string" && cwd !== "" ? cwd : process.cwd();
  const finalState = safeArgv.reduce(
    (state, arg, index, args) => reduceArgState(state, arg, index, args, safeCwd),
    {
      parsed: {},
      skipNext: false,
    },
  );

  return finalState.parsed;
}

function resolveTargetDir(runtime = {}) {
  if (typeof runtime.targetDir === "string" && runtime.targetDir !== "") {
    return runtime.targetDir;
  }

  if (typeof runtime.workspacePath === "string" && runtime.workspacePath !== "") {
    return path.join(runtime.workspacePath, ".github", "hooks");
  }

  const homedir = typeof runtime.homedir === "string" ? runtime.homedir : os.homedir();
  return path.join(homedir, ".copilot", "hooks");
}

function runHookOpsMain(runtime = {}, run) {
  const argv = chooseFirst([runtime.argv, process.argv.slice(2)], Array.isArray);
  const cwd = chooseFirst([runtime.cwd, process.cwd()], isNonEmptyString);
  const io = chooseFirst([runtime.io, {}], isNonNullObject);
  const ioHandlers = resolveIoHandlers(io);
  const result = run({
    ...runtime,
    ...parseArgs(argv, cwd),
    cwd,
  });
  return dispatchHookResult(result, ioHandlers);
}

module.exports = {
  reduceArgState,
  parseArgs,
  resolveTargetDir,
  runHookOpsMain,
};
