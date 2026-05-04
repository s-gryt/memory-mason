#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseJsonInput, detectPlatform } = require("./lib/config");
const { buildCommandErrorResult } = require("./lib/cli");
const {
  parseJsonlTranscript,
  filterMmTurns,
  renderTurnsAsMarkdown,
  normalizeTranscriptText,
} = require("./lib/transcript");
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
const {
  CAPTURE_MODE_LITE,
  HOOK_EVENT_STOP,
  DUPLICATE_CAPTURE_WINDOW_MS,
} = require("./lib/constants");
const {
  readStdin,
  toStringOrEmpty,
  firstNonEmptyString: firstNonEmptyStringFromRuntime,
  resolveTranscriptPath,
  resolveRuntimeEnv,
  resolveFallbackCwd,
  resolveRuntimeHomedir,
  resolveInputCwd,
  resolveRuntimeConfig,
  buildSuccessResult,
  runStdinMain,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
} = require("./lib/hook-runtime");

function firstNonEmptyString(values) {
  if (!Array.isArray(values)) {
    throw new Error("values must be an array");
  }
  return firstNonEmptyStringFromRuntime(values);
}

function normalizeHookEventName(eventName) {
  return toStringOrEmpty(eventName)
    .toLowerCase()
    .replace(/[\s_-]/g, "");
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

function parseTranscriptTurns(transcriptContent, captureMode = "lite") {
  if (transcriptContent === "") {
    return [];
  }

  return parseJsonlTranscript(transcriptContent, captureMode);
}

function buildStopAssistantSelection(turns, lastCount, lastAssistantMessage, captureMode) {
  const stopStartIndex = lastCount > 0 ? lastCount : Math.max(0, turns.length - 1);
  const assistantContents = collectAssistantTurnContents(turns, stopStartIndex);
  const lastTranscriptAssistantContent = getLastAssistantTurnContent(turns);
  const shouldAppendPayloadAssistant =
    lastAssistantMessage !== "" &&
    !assistantContents.includes(lastAssistantMessage) &&
    lastTranscriptAssistantContent !== lastAssistantMessage;
  const allSelectedTurns = shouldAppendPayloadAssistant
    ? assistantContents.concat([lastAssistantMessage])
    : assistantContents;

  if (captureMode === CAPTURE_MODE_LITE) {
    const liteSelectedTurns =
      allSelectedTurns.length > 0 ? [allSelectedTurns[allSelectedTurns.length - 1]] : [];
    return { selectedTurns: liteSelectedTurns, shouldAppendPayloadAssistant };
  }

  return { selectedTurns: allSelectedTurns, shouldAppendPayloadAssistant };
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
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);

  if (toStringOrEmpty(env.MEMORY_MASON_INVOKED_BY) !== "") {
    return buildSuccessResult();
  }

  try {
    const input = parseJsonInput(rawStdin);
    const platform = detectPlatform(input);
    const hookEventName = firstNonEmptyString([
      toStringOrEmpty(input.hookEventName),
      toStringOrEmpty(input.hook_event_name),
    ]);
    const normalizedHookEventName = normalizeHookEventName(hookEventName);
    const cwd = resolveInputCwd(input, fallbackCwd);
    const resolvedConfig = resolveRuntimeConfig(cwd, homedir);

    if (resolvedConfig.sync === false) {
      return buildSuccessResult();
    }

    const captureMode = resolvedConfig.captureMode;

    const sessionIdRaw = resolveSessionId(input);

    if (captureMode === CAPTURE_MODE_LITE && normalizedHookEventName !== HOOK_EVENT_STOP) {
      return buildSuccessResult();
    }

    if (normalizedHookEventName === "stop") {
      if (sessionIdRaw === "") {
        return buildSuccessResult();
      }

      const stopCaptureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
      if (getMmSuppressed(stopCaptureState)) {
        return buildSuccessResult();
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

      const turns = parseTranscriptTurns(transcriptContent, captureMode);
      const lastCount = getTranscriptTurnCount(stopCaptureState, sessionIdRaw);
      const lastAssistantMessage = normalizeTranscriptText(
        resolveLastAssistantMessage(input),
        captureMode,
      );
      const stopSelection = buildStopAssistantSelection(
        turns,
        lastCount,
        lastAssistantMessage,
        captureMode,
      );
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
      return buildSuccessResult();
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
      return buildSuccessResult();
    }

    const allTurns = parseJsonlTranscript(transcriptContent, captureMode);
    const filteredTurns = filterMmTurns(allTurns);
    if (filteredTurns.length < 1) {
      return buildSuccessResult();
    }

    const fullTranscriptMarkdown = renderTurnsAsMarkdown(filteredTurns);

    const today = localNow().date;
    const sessionId = firstNonEmptyString([sessionIdRaw, "unknown"]);
    const source = firstNonEmptyString([toStringOrEmpty(input.source), platform]);
    const captureRecord = buildCaptureRecord(sessionId, source, fullTranscriptMarkdown, Date.now());

    if (isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS)) {
      return buildSuccessResult();
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
    return buildSuccessResult();
  } catch (error) {
    return buildCommandErrorResult(error);
  }
}

function main(runtime = {}) {
  return runStdinMain(runtime, run);
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
  buildStopAssistantSelection,
  run,
  main,
};
