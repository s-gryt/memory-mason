"use strict";

const os = require("node:os");
const path = require("node:path");
const { writeIfPresent } = require("./cli");

function chooseFirst(candidates, predicate) {
  return candidates.find((value) => predicate(value));
}

function isFunctionValue(value) {
  return typeof value === "function";
}

function isNonNullObject(value) {
  return [typeof value === "object", value !== null].every(Boolean);
}

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
  const stdout = chooseFirst([io.stdout, (text) => process.stdout.write(text)], isFunctionValue);
  const stderr = chooseFirst([io.stderr, (text) => process.stderr.write(text)], isFunctionValue);
  const exit = chooseFirst([io.exit, (code) => process.exit(code)], isFunctionValue);
  const result = run({
    ...runtime,
    ...parseArgs(argv, cwd),
    cwd,
  });
  writeIfPresent(result.stdout, stdout);
  writeIfPresent(result.stderr, stderr);
  exit(result.status);
  return result;
}

module.exports = {
  reduceArgState,
  parseArgs,
  resolveTargetDir,
  runHookOpsMain,
};
