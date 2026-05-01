#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseJsonInput, detectPlatform, resolveVaultConfig } = require("./lib/config");
const { buildCommandErrorResult, writeIfPresent } = require("./lib/cli");
const { parseJsonlTranscript, filterMmTurns, renderTurnsAsMarkdown } = require("./lib/transcript");
const { buildSessionHeader, buildAssistantReplyEntry, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
const {
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getTranscriptTurnCount,
  setTranscriptTurnCount,
  getMmSuppressed,
} = require("./lib/capture-state");

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

  return Buffer.concat(readChunks()).toString("utf-8");
}

function toStringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function firstNonEmptyString(values) {
  if (!Array.isArray(values)) {
    throw new Error("values must be an array");
  }
  const match = values.find((value) => typeof value === "string" && value !== "");
  return typeof match === "string" ? match : "";
}

function normalizeHookEventName(eventName) {
  return toStringOrEmpty(eventName)
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function readConfigText(cwd) {
  const configPath = path.join(cwd, "memory-mason.json");
  if (!fs.existsSync(configPath)) {
    return "";
  }
  return fs.readFileSync(configPath, "utf-8");
}

function readDotEnvText(cwd) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    return "";
  }
  return fs.readFileSync(envPath, "utf-8");
}

function readGlobalConfigText(homedir) {
  const globalConfigPath = path.join(homedir, ".memory-mason", "config.json");
  if (!fs.existsSync(globalConfigPath)) {
    return "";
  }
  return fs.readFileSync(globalConfigPath, "utf-8");
}

function readGlobalDotEnvText(homedir) {
  const globalEnvPath = path.join(homedir, ".memory-mason", ".env");
  if (!fs.existsSync(globalEnvPath)) {
    return "";
  }
  return fs.readFileSync(globalEnvPath, "utf-8");
}

function readTranscriptFromPath(transcriptPath) {
  if (transcriptPath === "" || !fs.existsSync(transcriptPath)) {
    return "";
  }
  return fs.readFileSync(transcriptPath, "utf-8");
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
    (filePath) => filePath.endsWith(".jsonl") || filePath.endsWith(".json"),
  );

  if (files.length === 0) {
    return "";
  }

  const matchedFiles =
    safeSessionId === "" ? files : files.filter((filePath) => filePath.includes(safeSessionId));
  const candidateFiles = matchedFiles.length > 0 ? matchedFiles : files;
  const sortedCandidates = candidateFiles
    .map((filePath) => ({
      filePath,
      mtime: fs.statSync(filePath).mtimeMs,
    }))
    .sort((left, right) => right.mtime - left.mtime);

  return fs.readFileSync(sortedCandidates[0].filePath, "utf-8");
}

function findCopilotCliSessionContent(sessionStateDir, targetCwd) {
  if (!fs.existsSync(sessionStateDir)) {
    throw new Error(`copilot session-state dir not found: ${sessionStateDir}`);
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
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => path.join(fullPath, name)),
    }))
    .filter(({ jsonlFiles }) => jsonlFiles.length > 0);

  if (dirsWithJsonl.length === 0) {
    throw new Error("no .jsonl files found in copilot session-state");
  }

  const safeTargetCwd = toStringOrEmpty(targetCwd);
  const matchedDir =
    safeTargetCwd === ""
      ? dirsWithJsonl[0]
      : dirsWithJsonl.find(({ jsonlFiles }) =>
          jsonlFiles.some((filePath) => fs.readFileSync(filePath, "utf-8").includes(safeTargetCwd)),
        );

  const selectedDir = typeof matchedDir === "undefined" ? dirsWithJsonl[0] : matchedDir;
  const content = selectedDir.jsonlFiles
    .map((filePath) => fs.readFileSync(filePath, "utf-8"))
    .join("\n");

  if (content === "") {
    throw new Error("no transcript content found in copilot session-state");
  }

  return content;
}

function findCopilotCliSessionContentOrEmpty(sessionStateDir, targetCwd) {
  try {
    return findCopilotCliSessionContent(sessionStateDir, targetCwd);
  } catch (_error) {
    return "";
  }
}

function collectAssistantTurnContents(turns, startIndex) {
  return turns
    .slice(Math.max(0, startIndex))
    .filter(
      (turn) =>
        turn !== null &&
        typeof turn === "object" &&
        turn.role === "assistant" &&
        typeof turn.content === "string" &&
        turn.content !== "",
    )
    .map((turn) => turn.content);
}

function getLastAssistantTurnContent(turns) {
  const assistantContents = collectAssistantTurnContents(turns, 0);
  return assistantContents.length > 0 ? assistantContents[assistantContents.length - 1] : "";
}

function resolveTranscriptPath(input) {
  return firstNonEmptyString([
    toStringOrEmpty(input.transcript_path),
    toStringOrEmpty(input.transcriptPath),
  ]);
}

function resolveSessionId(input) {
  return firstNonEmptyString([toStringOrEmpty(input.session_id), toStringOrEmpty(input.sessionId)]);
}

function resolveLastAssistantMessage(input) {
  return firstNonEmptyString([
    toStringOrEmpty(input.last_assistant_message),
    toStringOrEmpty(input.lastAssistantMessage),
  ]);
}

function resolveCodexTranscriptPath(homedir) {
  return path.join(homedir, ".codex", "sessions");
}

function resolveCopilotTranscriptPath(homedir) {
  return path.join(homedir, ".copilot", "session-state");
}

function resolveCodexTranscriptContent(platform, transcriptFromPath, homedir, sessionIdRaw) {
  if (platform !== "codex" || transcriptFromPath !== "") {
    return "";
  }

  return findCodexSessionContent(resolveCodexTranscriptPath(homedir), sessionIdRaw);
}

function resolveCopilotTranscriptContent(platform, homedir, cwd) {
  if (platform !== "copilot-cli") {
    return "";
  }

  return findCopilotCliSessionContentOrEmpty(resolveCopilotTranscriptPath(homedir), cwd);
}

function resolveTranscriptContent(platform, transcriptFromPath, codexContent, copilotCliContent) {
  if (platform === "copilot-cli") {
    return copilotCliContent;
  }

  if (transcriptFromPath !== "") {
    return transcriptFromPath;
  }

  return codexContent;
}

function discoverTranscriptContent(platform, transcriptFromPath, homedir, sessionIdRaw, cwd) {
  const codexContent = resolveCodexTranscriptContent(
    platform,
    transcriptFromPath,
    homedir,
    sessionIdRaw,
  );
  const copilotCliContent = resolveCopilotTranscriptContent(platform, homedir, cwd);
  return resolveTranscriptContent(platform, transcriptFromPath, codexContent, copilotCliContent);
}

function parseTranscriptTurns(transcriptContent) {
  if (transcriptContent === "") {
    return [];
  }

  return parseJsonlTranscript(transcriptContent);
}

function buildStopAssistantSelection(turns, lastCount, lastAssistantMessage) {
  const stopStartIndex = lastCount > 0 ? lastCount : Math.max(0, turns.length - 1);
  const assistantContents = collectAssistantTurnContents(turns, stopStartIndex);
  const lastTranscriptAssistantContent = getLastAssistantTurnContent(turns);
  const shouldAppendPayloadAssistant =
    lastAssistantMessage !== "" &&
    !assistantContents.includes(lastAssistantMessage) &&
    lastTranscriptAssistantContent !== lastAssistantMessage;
  const selectedTurns = shouldAppendPayloadAssistant
    ? assistantContents.concat([lastAssistantMessage])
    : assistantContents;

  return {
    selectedTurns,
    shouldAppendPayloadAssistant,
  };
}

function calculateNextTurnCount(shouldAppendPayloadAssistant, turns, lastCount) {
  if (!shouldAppendPayloadAssistant) {
    return Math.max(lastCount, turns.length);
  }

  if (turns.length > 0) {
    return Math.max(turns.length + 1, lastCount + 1);
  }

  return Math.max(lastCount + 1, 2);
}

function writeAssistantTurns(vaultPath, subfolder, assistantContents) {
  if (assistantContents.length < 1) {
    return;
  }

  const now = localNow();

  assistantContents.forEach((content) => {
    appendToDaily(vaultPath, subfolder, now.date, buildAssistantReplyEntry(content, now.time));
  });
}

function run(rawStdin, runtime = {}) {
  const env = runtime.env !== null && typeof runtime.env === "object" ? runtime.env : process.env;
  const fallbackCwd = typeof runtime.cwd === "string" ? runtime.cwd : process.cwd();
  const homedir = typeof runtime.homedir === "string" ? runtime.homedir : os.homedir();

  if (toStringOrEmpty(env.MEMORY_MASON_INVOKED_BY) !== "") {
    return { status: 0, stdout: "", stderr: "" };
  }

  try {
    const input = parseJsonInput(rawStdin);
    const platform = detectPlatform(input);
    const hookEventName = firstNonEmptyString([
      toStringOrEmpty(input.hookEventName),
      toStringOrEmpty(input.hook_event_name),
    ]);
    const normalizedHookEventName = normalizeHookEventName(hookEventName);
    const cwd = firstNonEmptyString([toStringOrEmpty(input.cwd), fallbackCwd]);
    const configText = readConfigText(cwd);
    const dotEnvText = readDotEnvText(cwd);
    const globalConfigText = readGlobalConfigText(homedir);
    const globalDotEnvText = readGlobalDotEnvText(homedir);
    const resolvedConfig = resolveVaultConfig(
      cwd,
      toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH),
      configText,
      homedir,
      {
        dotEnvText,
        globalConfigText,
        globalDotEnvText,
      },
    );

    if (resolvedConfig.sync === false) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const sessionIdRaw = resolveSessionId(input);

    if (normalizedHookEventName === "stop") {
      if (sessionIdRaw === "") {
        return { status: 0, stdout: "", stderr: "" };
      }

      const stopCaptureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
      if (getMmSuppressed(stopCaptureState)) {
        return { status: 0, stdout: "", stderr: "" };
      }

      const transcriptPath = resolveTranscriptPath(input);
      const transcriptFromPath = readTranscriptFromPath(transcriptPath);
      const transcriptContent = discoverTranscriptContent(
        platform,
        transcriptFromPath,
        homedir,
        sessionIdRaw,
        cwd,
      );

      const turns = parseTranscriptTurns(transcriptContent);
      const lastCount = getTranscriptTurnCount(stopCaptureState, sessionIdRaw);
      const lastAssistantMessage = resolveLastAssistantMessage(input);
      const stopSelection = buildStopAssistantSelection(turns, lastCount, lastAssistantMessage);
      const stopAssistantContents = stopSelection.selectedTurns;

      writeAssistantTurns(
        resolvedConfig.vaultPath,
        resolvedConfig.subfolder,
        stopAssistantContents,
      );

      const nextTurnCount = calculateNextTurnCount(
        stopSelection.shouldAppendPayloadAssistant,
        turns,
        lastCount,
      );
      const updatedState = setTranscriptTurnCount(stopCaptureState, sessionIdRaw, nextTurnCount);
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, updatedState);
      return { status: 0, stdout: "", stderr: "" };
    }

    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
    const transcriptPath = resolveTranscriptPath(input);
    const transcriptFromPath = readTranscriptFromPath(transcriptPath);
    const transcriptContent = discoverTranscriptContent(
      platform,
      transcriptFromPath,
      homedir,
      sessionIdRaw,
      cwd,
    );

    if (transcriptContent === "") {
      return { status: 0, stdout: "", stderr: "" };
    }

    const allTurns = parseJsonlTranscript(transcriptContent);
    const filteredTurns = filterMmTurns(allTurns);
    if (filteredTurns.length < 1) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const fullTranscriptMarkdown = renderTurnsAsMarkdown(filteredTurns);

    const today = localNow().date;
    const sessionId = firstNonEmptyString([sessionIdRaw, "unknown"]);
    const source = firstNonEmptyString([toStringOrEmpty(input.source), platform]);
    const captureRecord = buildCaptureRecord(sessionId, source, fullTranscriptMarkdown, Date.now());

    if (isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS)) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const now = localNow();
    const sessionHeader = buildSessionHeader(sessionId, source, `${now.date}T${now.time}`);
    appendToDaily(
      resolvedConfig.vaultPath,
      resolvedConfig.subfolder,
      today,
      sessionHeader + fullTranscriptMarkdown,
    );
    saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, {
      ...captureState,
      lastCapture: captureRecord,
    });
    return { status: 0, stdout: "", stderr: "" };
  } catch (error) {
    return buildCommandErrorResult(error);
  }
}

function main(runtime = {}) {
  /* c8 ignore start */
  const io = runtime.io !== null && typeof runtime.io === "object" ? runtime.io : {};
  const stdout = typeof io.stdout === "function" ? io.stdout : (text) => process.stdout.write(text);
  const stderr = typeof io.stderr === "function" ? io.stderr : (text) => process.stderr.write(text);
  const exit = typeof io.exit === "function" ? io.exit : (code) => process.exit(code);
  const fsApi = runtime.fs !== null && typeof runtime.fs === "object" ? runtime.fs : fs;
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
  readTranscriptFromPath,
  listFilesRecursive,
  findCodexSessionContent,
  findCopilotCliSessionContent,
  findCopilotCliSessionContentOrEmpty,
  collectAssistantTurnContents,
  getLastAssistantTurnContent,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  run,
  main,
};
