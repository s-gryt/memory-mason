#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseJsonInput, resolveVaultConfig } = require('./lib/config');
const {
  buildKnowledgeIndexPath,
  buildDailyFilePath,
  takeLastLines,
  buildAdditionalContext,
  truncateContext
} = require('./lib/vault');

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

function readDotEnvText(cwd) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) {
    return '';
  }
  return fs.readFileSync(envPath, 'utf-8');
}

function readGlobalConfigText(homedir) {
  const globalConfigPath = path.join(homedir, '.memory-mason', 'config.json');
  if (!fs.existsSync(globalConfigPath)) {
    return '';
  }
  return fs.readFileSync(globalConfigPath, 'utf-8');
}

function readFileOrEmpty(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    return '';
  }
}

function readRecentDailyLog(vaultPath, subfolder) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayPath = buildDailyFilePath(vaultPath, subfolder, today);
  if (fs.existsSync(todayPath)) {
    return takeLastLines(readFileOrEmpty(todayPath), 30);
  }
  const yesterdayPath = buildDailyFilePath(vaultPath, subfolder, yesterday);
  if (fs.existsSync(yesterdayPath)) {
    return takeLastLines(readFileOrEmpty(yesterdayPath), 30);
  }
  return '';
}

function resolveRuntimeEnv(runtime) {
  return runtime.env !== null && typeof runtime.env === 'object' ? runtime.env : process.env;
}

function resolveFallbackCwd(runtime) {
  return typeof runtime.cwd === 'string' ? runtime.cwd : process.cwd();
}

function resolveRuntimeHomedir(runtime) {
  return typeof runtime.homedir === 'string' ? runtime.homedir : os.homedir();
}

function resolveInputCwd(input, fallbackCwd) {
  const inputCwd = toStringOrEmpty(input.cwd);
  return inputCwd !== '' ? inputCwd : fallbackCwd;
}

function readConfigSources(cwd, homedir) {
  return {
    configText: readConfigText(cwd),
    dotEnvText: readDotEnvText(cwd),
    globalConfigText: readGlobalConfigText(homedir)
  };
}

function resolveRuntimeConfig(cwd, env, homedir) {
  const configSources = readConfigSources(cwd, homedir);
  return resolveVaultConfig(cwd, toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH), configSources.configText, homedir, {
    dotEnvText: configSources.dotEnvText,
    globalConfigText: configSources.globalConfigText
  });
}

function buildSessionAdditionalContext(resolvedConfig) {
  const indexPath = buildKnowledgeIndexPath(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const indexText = readFileOrEmpty(indexPath);
  const recentLogText = readRecentDailyLog(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  return truncateContext(buildAdditionalContext(indexText, recentLogText), 10000);
}

function buildSessionStartStdout(additionalContext) {
  return (
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      }
    }) + '\n'
  );
}

function buildSuccessResult(additionalContext) {
  return {
    status: 0,
    stdout: buildSessionStartStdout(additionalContext),
    stderr: ''
  };
}

function buildErrorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 0,
    stdout: '',
    stderr: message + '\n'
  };
}

function run(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);

  try {
    const input = parseJsonInput(rawStdin);
    const cwd = resolveInputCwd(input, fallbackCwd);
    const resolvedConfig = resolveRuntimeConfig(cwd, env, homedir);
    const additionalContext = buildSessionAdditionalContext(resolvedConfig);
    return buildSuccessResult(additionalContext);
  } catch (error) {
    return buildErrorResult(error);
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
  readDotEnvText,
  readGlobalConfigText,
  run,
  main
};