#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseJsonInput, detectPlatform, resolveVaultConfig } = require('./lib/config');
const { buildDailyEntry } = require('./lib/vault');
const { appendToDaily } = require('./lib/writer');

function readStdin(fsApi = fs) {
  const fd = 0;

  function readChunks() {
    const chunk = Buffer.alloc(65536);
    const bytesRead = fsApi.readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead <= 0) {
      return [];
    }
    return [chunk.slice(0, bytesRead)].concat(readChunks());
  }

  return Buffer.concat(readChunks()).toString('utf-8');
}

function toStringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function readConfigText(cwd) {
  const configPath = path.join(cwd, 'memory-mason.json');
  if (!fs.existsSync(configPath)) {
    return '';
  }
  return fs.readFileSync(configPath, 'utf-8');
}

function extractToolPayload(platform, input) {
  if (platform === 'claude-code' || platform === 'copilot-vscode') {
    return {
      toolName: toStringOrEmpty(input.tool_name),
      resultText: toStringOrEmpty(input.tool_response)
    };
  }

  if (platform === 'copilot-cli') {
    const toolResult =
      input.toolResult !== null && typeof input.toolResult === 'object' && !Array.isArray(input.toolResult)
        ? input.toolResult
        : {};
    const textResultForLlm =
      typeof toolResult.textResultForLlm === 'string' ? toolResult.textResultForLlm : '';

    return {
      toolName: toStringOrEmpty(input.toolName),
      resultText: textResultForLlm
    };
  }

  if (platform === 'codex') {
    return {
      toolName: toStringOrEmpty(input.tool_name),
      resultText: toStringOrEmpty(input.tool_result)
    };
  }

  throw new Error('unsupported platform: ' + platform);
}

function run(rawStdin, runtime = {}) {
  const env = runtime.env !== null && typeof runtime.env === 'object' ? runtime.env : process.env;
  const fallbackCwd = typeof runtime.cwd === 'string' ? runtime.cwd : process.cwd();
  const homedir = typeof runtime.homedir === 'string' ? runtime.homedir : os.homedir();

  try {
    const input = parseJsonInput(rawStdin);
    const platform = detectPlatform(input);
    const payload = extractToolPayload(platform, input);
    const noisyTools = ['Read', 'Glob', 'LS', 'List', 'ls', 'read', 'glob'];

    if (payload.toolName === '' || noisyTools.includes(payload.toolName)) {
      return { status: 0, stdout: '', stderr: '' };
    }

    const cwd = toStringOrEmpty(input.cwd) !== '' ? toStringOrEmpty(input.cwd) : fallbackCwd;
    const configText = readConfigText(cwd);
    const resolvedConfig = resolveVaultConfig(cwd, toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH), configText, homedir);

    const today = new Date().toISOString().slice(0, 10);
    const timestamp = new Date().toISOString().slice(11, 19);
    const dailyEntry = buildDailyEntry(payload.toolName, payload.resultText, timestamp);
    appendToDaily(resolvedConfig.vaultPath, resolvedConfig.subfolder, today, dailyEntry);
    return { status: 0, stdout: '', stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 0,
      stdout: '',
      stderr: message + '\n'
    };
  }
}

function main(runtime = {}) {
  const io = runtime.io !== null && typeof runtime.io === 'object' ? runtime.io : {};
  const stdout = typeof io.stdout === 'function' ? io.stdout : (text) => process.stdout.write(text);
  const stderr = typeof io.stderr === 'function' ? io.stderr : (text) => process.stderr.write(text);
  const exit = typeof io.exit === 'function' ? io.exit : (code) => process.exit(code);
  const fsApi = runtime.fs !== null && typeof runtime.fs === 'object' ? runtime.fs : fs;
  const result = run(readStdin(fsApi), runtime);

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
  readStdin,
  extractToolPayload,
  run,
  main
};