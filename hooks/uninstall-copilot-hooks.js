#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeIfPresent } = require('./lib/cli');

const hookFiles = [
  'session-start.json',
  'user-prompt-submit.json',
  'post-tool-use.json',
  'pre-compact.json',
  'stop.json',
  'session-end.json'
];

function reduceArgState(state, arg, index, args, safeCwd) {
  if (state.skipNext) {
    return {
      parsed: state.parsed,
      skipNext: false
    };
  }

  if (arg === '--workspace' || arg === '-w') {
    const workspacePath = args[index + 1];
    if (typeof workspacePath !== 'string' || workspacePath === '') {
      throw new Error(arg + ' requires a workspace path');
    }

    return {
      parsed: {
        ...state.parsed,
        workspacePath: path.resolve(safeCwd, workspacePath)
      },
      skipNext: true
    };
  }

  throw new Error('unknown argument: ' + arg);
}

function parseArgs(argv, cwd) {
  const safeArgv = Array.isArray(argv) ? argv : [];
  const safeCwd = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
  const finalState = safeArgv.reduce(
    (state, arg, index, args) => reduceArgState(state, arg, index, args, safeCwd),
    {
      parsed: {},
      skipNext: false
    }
  );

  return finalState.parsed;
}

function resolveTargetDir(runtime = {}) {
  if (typeof runtime.targetDir === 'string' && runtime.targetDir !== '') {
    return runtime.targetDir;
  }

  if (typeof runtime.workspacePath === 'string' && runtime.workspacePath !== '') {
    return path.join(runtime.workspacePath, '.github', 'hooks');
  }

  const homedir = typeof runtime.homedir === 'string' ? runtime.homedir : os.homedir();
  return path.join(homedir, '.copilot', 'hooks');
}

function buildHookPaths(targetDir) {
  return hookFiles.map((fileName) => path.join(targetDir, fileName));
}

function removeHookFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.rmSync(filePath, { force: true });
}

function removeHookFiles(filePaths) {
  filePaths.forEach((filePath) => removeHookFile(filePath));
}

function run(runtime = {}) {
  const targetDir = resolveTargetDir(runtime);
  const filePaths = buildHookPaths(targetDir);
  removeHookFiles(filePaths);

  return {
    status: 0,
    stdout: 'Removed Memory Mason Copilot hooks from ' + targetDir + '\n',
    stderr: ''
  };
}

function main(runtime = {}) {
  /* c8 ignore start */
  const argv = Array.isArray(runtime.argv) ? runtime.argv : process.argv.slice(2);
  const cwd = typeof runtime.cwd === 'string' && runtime.cwd !== '' ? runtime.cwd : process.cwd();
  const io = runtime.io !== null && typeof runtime.io === 'object' ? runtime.io : {};
  const stdout = typeof io.stdout === 'function' ? io.stdout : (text) => process.stdout.write(text);
  const stderr = typeof io.stderr === 'function' ? io.stderr : (text) => process.stderr.write(text);
  const exit = typeof io.exit === 'function' ? io.exit : (code) => process.exit(code);
  /* c8 ignore stop */
  const result = run({
    ...runtime,
    ...parseArgs(argv, cwd),
    cwd
  });
  /* c8 ignore start */
  writeIfPresent(result.stdout, stdout);
  writeIfPresent(result.stderr, stderr);
  exit(result.status);
  /* c8 ignore stop */
  return result;
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
  main
};