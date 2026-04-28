#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseJsonInput, detectPlatform, resolveVaultConfig } = require('./lib/config');
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

function readTranscriptFromPath(transcriptPath) {
  if (transcriptPath === '' || !fs.existsSync(transcriptPath)) {
    return '';
  }
  return fs.readFileSync(transcriptPath, 'utf-8');
}

function listFilesRecursive(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  return entries.reduce((accumulator, entry) => {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      return accumulator.concat(listFilesRecursive(fullPath));
    }
    return accumulator.concat([fullPath]);
  }, []);
}

function findCodexSessionContent(sessionRootDir, sessionId) {
  const safeSessionId = toStringOrEmpty(sessionId);
  const files = listFilesRecursive(sessionRootDir).filter(
    (filePath) => filePath.endsWith('.jsonl') || filePath.endsWith('.json')
  );

  if (files.length === 0) {
    return '';
  }

  const matchedFiles =
    safeSessionId === '' ? files : files.filter((filePath) => filePath.includes(safeSessionId));
  const candidateFiles = matchedFiles.length > 0 ? matchedFiles : files;
  const sortedCandidates = candidateFiles
    .map((filePath) => ({
      filePath,
      mtime: fs.statSync(filePath).mtimeMs
    }))
    .sort((left, right) => right.mtime - left.mtime);

  if (sortedCandidates.length === 0) {
    return '';
  }

  return fs.readFileSync(sortedCandidates[0].filePath, 'utf-8');
}

function findCopilotCliSessionContent(sessionStateDir, targetCwd) {
  if (!fs.existsSync(sessionStateDir)) {
    throw new Error('copilot session-state dir not found: ' + sessionStateDir);
  }

  const entries = fs.readdirSync(sessionStateDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(sessionStateDir, entry.name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtime: stat.mtimeMs };
    })
    .sort((left, right) => right.mtime - left.mtime);

  const dirsWithJsonl = dirs
    .map(({ fullPath, mtime }) => ({
      fullPath,
      mtime,
      jsonlFiles: fs
        .readdirSync(fullPath)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => path.join(fullPath, name))
    }))
    .filter(({ jsonlFiles }) => jsonlFiles.length > 0);

  if (dirsWithJsonl.length === 0) {
    throw new Error('no .jsonl files found in copilot session-state');
  }

  const safeTargetCwd = toStringOrEmpty(targetCwd);
  const matchedDir =
    safeTargetCwd === ''
      ? dirsWithJsonl[0]
      : dirsWithJsonl.find(({ jsonlFiles }) =>
          jsonlFiles.some((filePath) => fs.readFileSync(filePath, 'utf-8').includes(safeTargetCwd))
        );

  const selectedDir = typeof matchedDir === 'undefined' ? dirsWithJsonl[0] : matchedDir;
  const content = selectedDir.jsonlFiles.map((filePath) => fs.readFileSync(filePath, 'utf-8')).join('\n');

  if (content === '') {
    throw new Error('no transcript content found in copilot session-state');
  }

  return content;
}

function findCopilotCliSessionContentOrEmpty(sessionStateDir, targetCwd) {
  try {
    return findCopilotCliSessionContent(sessionStateDir, targetCwd);
  } catch (error) {
    return '';
  }
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
    const platform = detectPlatform(input);
    const cwd = firstNonEmptyString([toStringOrEmpty(input.cwd), fallbackCwd]);
    const configText = readConfigText(cwd);
    const resolvedConfig = resolveVaultConfig(cwd, toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH), configText, homedir);

    const transcriptPath = firstNonEmptyString([
      toStringOrEmpty(input.transcript_path),
      toStringOrEmpty(input.transcriptPath)
    ]);
    const transcriptFromPath = readTranscriptFromPath(transcriptPath);
    const sessionIdRaw = firstNonEmptyString([
      toStringOrEmpty(input.session_id),
      toStringOrEmpty(input.sessionId)
    ]);

    const codexContent =
      platform === 'codex' && transcriptFromPath === ''
        ? findCodexSessionContent(path.join(homedir, '.codex', 'sessions'), sessionIdRaw)
        : '';

    const copilotCliContent =
      platform === 'copilot-cli'
        ? findCopilotCliSessionContentOrEmpty(path.join(homedir, '.copilot', 'session-state'), cwd)
        : '';

    const transcriptContent =
      platform === 'copilot-cli'
        ? copilotCliContent
        : transcriptFromPath !== ''
          ? transcriptFromPath
          : codexContent;

    if (transcriptContent === '') {
      return { status: 0, stdout: '', stderr: '' };
    }

    const excerpt = buildTranscriptExcerpt(transcriptContent, 30, 15000);
    if (excerpt.turnCount < 1) {
      return { status: 0, stdout: '', stderr: '' };
    }

    const today = new Date().toISOString().slice(0, 10);
    const sessionId = firstNonEmptyString([sessionIdRaw, 'unknown']);
    const source = firstNonEmptyString([toStringOrEmpty(input.source), platform]);
    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
    const captureRecord = buildCaptureRecord(sessionId, source, excerpt.markdown, Date.now());

    if (isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS)) {
      return { status: 0, stdout: '', stderr: '' };
    }

    const sessionHeader = buildSessionHeader(sessionId, source, new Date().toISOString());
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
  readTranscriptFromPath,
  listFilesRecursive,
  findCodexSessionContent,
  findCopilotCliSessionContent,
  findCopilotCliSessionContentOrEmpty,
  run,
  main
};