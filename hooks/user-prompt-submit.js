#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseJsonInput, detectPlatform, resolveVaultConfig } = require('./lib/config');
const { buildCommandErrorResult, writeIfPresent } = require('./lib/cli');
const { buildDailyEntry, localNow } = require('./lib/vault');
const { appendToDaily } = require('./lib/writer');
const { extractPromptEntry } = require('./lib/prompt');
const { parseJsonlTranscript } = require('./lib/transcript');
const {
  loadCaptureState,
  saveCaptureState,
  setTranscriptTurnCount
} = require('./lib/capture-state');

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

function firstNonEmptyString(values) {
  const match = values.find((value) => typeof value === 'string' && value !== '');
  return typeof match === 'string' ? match : '';
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

function readGlobalDotEnvText(homedir) {
  const globalEnvPath = path.join(homedir, '.memory-mason', '.env');
  if (!fs.existsSync(globalEnvPath)) {
    return '';
  }
  return fs.readFileSync(globalEnvPath, 'utf-8');
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
    globalConfigText: readGlobalConfigText(homedir),
    globalDotEnvText: readGlobalDotEnvText(homedir)
  };
}

function resolveRuntimeConfig(cwd, env, homedir) {
  const configSources = readConfigSources(cwd, homedir);
  return resolveVaultConfig(cwd, toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH), configSources.configText, homedir, {
    dotEnvText: configSources.dotEnvText,
    globalConfigText: configSources.globalConfigText,
    globalDotEnvText: configSources.globalDotEnvText
  });
}

function resolvePromptPayload(rawStdin) {
  const input = parseJsonInput(rawStdin);
  const platform = detectPlatform(input);
  const promptEntry = extractPromptEntry(platform, input);
  return {
    input,
    promptEntry
  };
}

function buildPromptStateAnchors(input) {
  return {
    transcriptPath: firstNonEmptyString([toStringOrEmpty(input.transcript_path), toStringOrEmpty(input.transcriptPath)]),
    sessionId: firstNonEmptyString([toStringOrEmpty(input.session_id), toStringOrEmpty(input.sessionId)])
  };
}

function buildCaptureTimestamp() {
  const now = localNow();
  return {
    today: now.date,
    timestamp: now.time
  };
}

function buildRunPlan(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);
  const payload = resolvePromptPayload(rawStdin);
  const cwd = resolveInputCwd(payload.input, fallbackCwd);
  const anchors = buildPromptStateAnchors(payload.input);
  const captureTimestamp = buildCaptureTimestamp();
  return {
    env,
    homedir,
    cwd,
    input: payload.input,
    promptEntry: payload.promptEntry,
    transcriptPath: anchors.transcriptPath,
    sessionId: anchors.sessionId,
    today: captureTimestamp.today,
    timestamp: captureTimestamp.timestamp
  };
}

function shouldUpdateTranscriptState(transcriptPath, sessionId) {
  return transcriptPath !== '' && sessionId !== '' && fs.existsSync(transcriptPath);
}

function updateTranscriptState(resolvedConfig, transcriptPath, sessionId) {
  const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
  const turns = parseJsonlTranscript(transcriptContent);
  const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const updatedState = setTranscriptTurnCount(captureState, sessionId, turns.length);
  saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, updatedState);
}

function persistPromptSubmission(plan) {
  const resolvedConfig = resolveRuntimeConfig(plan.cwd, plan.env, plan.homedir);

  if (shouldUpdateTranscriptState(plan.transcriptPath, plan.sessionId)) {
    updateTranscriptState(resolvedConfig, plan.transcriptPath, plan.sessionId);
  }

  const dailyEntry = buildDailyEntry(plan.promptEntry.entryName, plan.promptEntry.text, plan.timestamp);
  appendToDaily(resolvedConfig.vaultPath, resolvedConfig.subfolder, plan.today, dailyEntry);
}

function run(rawStdin, runtime = {}) {
  try {
    const plan = buildRunPlan(rawStdin, runtime);

    if (plan.promptEntry.text === '') {
      return { status: 0, stdout: '', stderr: '' };
    }

    persistPromptSubmission(plan);
    return { status: 0, stdout: '', stderr: '' };
  } catch (error) {
    return buildCommandErrorResult(error);
  }
}

function main(runtime = {}) {
  /* c8 ignore start */
  const io = runtime.io !== null && typeof runtime.io === 'object' ? runtime.io : {};
  const stdout = typeof io.stdout === 'function' ? io.stdout : (text) => process.stdout.write(text);
  const stderr = typeof io.stderr === 'function' ? io.stderr : (text) => process.stderr.write(text);
  const exit = typeof io.exit === 'function' ? io.exit : (code) => process.exit(code);
  const fsApi = runtime.fs !== null && typeof runtime.fs === 'object' ? runtime.fs : fs;
  /* c8 ignore stop */
  const result = run(readStdin(fsApi), runtime);
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
  readStdin,
  firstNonEmptyString,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  run,
  main
};