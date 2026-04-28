#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseJsonInput, resolveVaultConfig } = require('./lib/config');
const { buildTranscriptExcerpt } = require('./lib/transcript');
const { buildSessionHeader } = require('./lib/vault');
const { appendToDaily } = require('./lib/writer');
const { loadCaptureState, saveCaptureState, buildCaptureRecord, isDuplicateCapture } = require('./lib/capture-state');

const DUPLICATE_CAPTURE_WINDOW_MS = 60000;

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
  if (!Array.isArray(values)) {
    throw new Error('values must be an array');
  }
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

function resolveTranscriptPath(input) {
  return firstNonEmptyString([toStringOrEmpty(input.transcript_path), toStringOrEmpty(input.transcriptPath)]);
}

function run(rawStdin, runtime = {}) {
  const env = runtime.env !== null && typeof runtime.env === 'object' ? runtime.env : process.env;
  const fallbackCwd = typeof runtime.cwd === 'string' ? runtime.cwd : process.cwd();
  const homedir = typeof runtime.homedir === 'string' ? runtime.homedir : os.homedir();

  if (toStringOrEmpty(env.MEMORY_MASON_INVOKED_BY) !== '') {
    return { status: 0, stdout: '', stderr: '' };
  }

  try {
    const input = parseJsonInput(rawStdin);
    const transcriptPath = resolveTranscriptPath(input);

    if (transcriptPath === '' || !fs.existsSync(transcriptPath)) {
      return { status: 0, stdout: '', stderr: '' };
    }

    const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
    const excerpt = buildTranscriptExcerpt(transcriptContent, 30, 15000);

    if (excerpt.turnCount < 5) {
      return { status: 0, stdout: '', stderr: '' };
    }

    const cwd = toStringOrEmpty(input.cwd) !== '' ? toStringOrEmpty(input.cwd) : fallbackCwd;
    const configText = readConfigText(cwd);
    const resolvedConfig = resolveVaultConfig(cwd, toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH), configText, homedir);

    const today = new Date().toISOString().slice(0, 10);
    const sessionId = firstNonEmptyString([
      toStringOrEmpty(input.session_id),
      toStringOrEmpty(input.sessionId),
      'unknown'
    ]);
    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
    const captureRecord = buildCaptureRecord(sessionId, 'pre-compact', excerpt.markdown, Date.now());

    if (isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS)) {
      return { status: 0, stdout: '', stderr: '' };
    }

    const sessionHeader = buildSessionHeader(sessionId, 'pre-compact', new Date().toISOString());
    appendToDaily(resolvedConfig.vaultPath, resolvedConfig.subfolder, today, sessionHeader + excerpt.markdown);
    saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, {
      ...captureState,
      lastCapture: captureRecord
    });
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
  resolveTranscriptPath,
  run,
  main
};