#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseJsonInput, detectPlatform, resolveVaultConfig } = require('./lib/config');
const { buildDailyEntry, buildAssistantReplyEntry } = require('./lib/vault');
const { appendToDaily } = require('./lib/writer');
const { extractPromptEntry } = require('./lib/prompt');
const { parseJsonlTranscript } = require('./lib/transcript');
const {
  loadCaptureState,
  saveCaptureState,
  getTranscriptTurnCount,
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

function run(rawStdin, runtime = {}) {
  const env = runtime.env !== null && typeof runtime.env === 'object' ? runtime.env : process.env;
  const fallbackCwd = typeof runtime.cwd === 'string' ? runtime.cwd : process.cwd();
  const homedir = typeof runtime.homedir === 'string' ? runtime.homedir : os.homedir();

  try {
    const input = parseJsonInput(rawStdin);
    const platform = detectPlatform(input);
    const promptEntry = extractPromptEntry(platform, input);

    if (promptEntry.text === '') {
      return { status: 0, stdout: '', stderr: '' };
    }

    const cwd = toStringOrEmpty(input.cwd) !== '' ? toStringOrEmpty(input.cwd) : fallbackCwd;
    const configText = readConfigText(cwd);
    const dotEnvText = readDotEnvText(cwd);
    const globalConfigText = readGlobalConfigText(homedir);
    const resolvedConfig = resolveVaultConfig(cwd, toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH), configText, homedir, {
      dotEnvText,
      globalConfigText
    });

    const today = new Date().toISOString().slice(0, 10);
    const timestamp = new Date().toISOString().slice(11, 19);
    const transcriptPath = firstNonEmptyString([
      toStringOrEmpty(input.transcript_path),
      toStringOrEmpty(input.transcriptPath)
    ]);
    const sessionId = firstNonEmptyString([
      toStringOrEmpty(input.session_id),
      toStringOrEmpty(input.sessionId)
    ]);

    if (transcriptPath !== '' && sessionId !== '' && fs.existsSync(transcriptPath)) {
      const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
      const turns = parseJsonlTranscript(transcriptContent);
      const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
      const lastCount = getTranscriptTurnCount(captureState, sessionId);
      const newTurns = turns.slice(lastCount);
      const assistantTurns = newTurns.filter((turn) => turn.role === 'assistant');

      if (assistantTurns.length > 0) {
        assistantTurns.forEach((turn) => {
          appendToDaily(
            resolvedConfig.vaultPath,
            resolvedConfig.subfolder,
            today,
            buildAssistantReplyEntry(turn.content, timestamp)
          );
        });
      }

      const updatedState = setTranscriptTurnCount(captureState, sessionId, turns.length);
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, updatedState);
    }

    const dailyEntry = buildDailyEntry(promptEntry.entryName, promptEntry.text, timestamp);
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
  firstNonEmptyString,
  readDotEnvText,
  readGlobalConfigText,
  run,
  main
};