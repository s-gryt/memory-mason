#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const hookFiles = ['session-start.json', 'user-prompt-submit.json', 'post-tool-use.json', 'pre-compact.json', 'stop.json'];

function run(runtime = {}) {
  const homedir = typeof runtime.homedir === 'string' ? runtime.homedir : os.homedir();
  const targetDir = path.join(homedir, '.copilot', 'hooks');

  hookFiles.forEach((fileName) => {
    const targetPath = path.join(targetDir, fileName);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
  });

  return {
    status: 0,
    stdout: 'Removed Memory Mason Copilot hooks from ' + targetDir + '\n',
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
  run,
  main
};