#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, '.github', 'hooks');
const hookFiles = ['session-start.json', 'user-prompt-submit.json', 'post-tool-use.json', 'pre-compact.json', 'stop.json'];

function rewriteEntry(entry, hookRoot) {
  if (entry === null || typeof entry !== 'object') {
    return entry;
  }

  if (typeof entry.command === 'string') {
    entry.command = entry.command.replace(/^node hooks\/(.+)$/u, `node "${hookRoot}/$1"`);
  }

  if (Array.isArray(entry.hooks)) {
    entry.hooks = entry.hooks.map((childEntry) => rewriteEntry(childEntry, hookRoot));
  }

  return entry;
}

function rewriteHookFile(fileName, hookRoot) {
  const sourcePath = path.join(sourceDir, fileName);
  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));

  Object.keys(parsed.hooks).forEach((eventName) => {
    const entries = parsed.hooks[eventName];
    if (Array.isArray(entries)) {
      parsed.hooks[eventName] = entries.map((entry) => rewriteEntry(entry, hookRoot));
    }
  });

  return JSON.stringify(parsed, null, 2) + '\n';
}

function run(runtime = {}) {
  const homedir = typeof runtime.homedir === 'string' ? runtime.homedir : os.homedir();
  const targetDir = path.join(homedir, '.copilot', 'hooks');
  const hookRoot = path.join(repoRoot, 'hooks').replace(/\\/g, '/');

  fs.mkdirSync(targetDir, { recursive: true });

  hookFiles.forEach((fileName) => {
    const sourcePath = path.join(sourceDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error('missing source hook file: ' + sourcePath);
    }

    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, rewriteHookFile(fileName, hookRoot), 'utf-8');
  });

  return {
    status: 0,
    stdout: 'Installed Memory Mason Copilot hooks to ' + targetDir + '\n',
    stderr: ''
  };
}

function main(runtime = {}) {
  const io = runtime.io !== null && typeof runtime.io === 'object' ? runtime.io : {};
  const stdout = typeof io.stdout === 'function' ? io.stdout : (text) => process.stdout.write(text);
  const stderr = typeof io.stderr === 'function' ? io.stderr : (text) => process.stderr.write(text);
  const exit = typeof io.exit === 'function' ? io.exit : (code) => process.exit(code);
  const result = run(runtime);

  if (result.stdout !== '') {
    stdout(result.stdout);
  }

  if (result.stderr !== '') {
    stderr(result.stderr);
  }

  exit(result.status);
  return result;
}

if (require.main === module) {
  main();
}

module.exports = {
  rewriteEntry,
  rewriteHookFile,
  run,
  main
};