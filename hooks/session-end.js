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
const { recordCaptureMetrics } = require("./lib/state");
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
  UTF8_ENCODING,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
} = require("./lib/constants");
const { PLATFORM_COPILOT_CLI, PLATFORM_CODEX } = require("./lib/platforms");
const { UNKNOWN_LABEL } = require("./lib/markdown-labels");
const { ENV_KEY_INVOKED_BY } = require("./lib/config-keys");
const { stripMemoryTags, countMemoryTags, MAX_TAG_STRIP_COUNT } = require("./lib/tag-stripper");
const { detectSensitiveContent } = require("./lib/sensitive-guard");
const { compressNarrativeText } = require("./lib/compress");
const { HOOK_EVENT_SESSION_END_KEBAB } = require("./lib/hook-events");
const { TRANSCRIPT_ROLE_ASSISTANT } = require("./lib/transcript-labels");
const { stripVTControlCharacters } = require("node:util");
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

const CODEX_DIR = ".codex";
const CODEX_SESSIONS_DIR = "sessions";
const COPILOT_STATE_DIR = ".copilot";
const COPILOT_SESSION_STATE_DIR = "session-state";
const ZERO = 0;
const ONE = 1;
const EMPTY_STRING = "";
const NEWLINE = "\n";

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
  return fs.readFileSync(transcriptPath, UTF8_ENCODING);
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

  return fs.readFileSync(sortedCandidates[0].filePath, UTF8_ENCODING);
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
          jsonlFiles.some((filePath) =>
            fs.readFileSync(filePath, UTF8_ENCODING).includes(safeTargetCwd),
          ),
        );

  const selectedDir = typeof matchedDir === "undefined" ? dirsWithJsonl[0] : matchedDir;
  const content = selectedDir.jsonlFiles
    .map((filePath) => fs.readFileSync(filePath, UTF8_ENCODING))
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
  return path.join(homedir, CODEX_DIR, CODEX_SESSIONS_DIR);
}

function resolveCopilotTranscriptPath(homedir) {
  return path.join(homedir, COPILOT_STATE_DIR, COPILOT_SESSION_STATE_DIR);
}

function resolveCodexTranscriptContent(platform, transcriptFromPath, homedir, sessionIdRaw) {
  if (platform !== PLATFORM_CODEX || transcriptFromPath !== "") {
    return "";
  }

  return findCodexSessionContent(resolveCodexTranscriptPath(homedir), sessionIdRaw);
}

function resolveCopilotTranscriptContent(platform, homedir, cwd) {
  if (platform !== PLATFORM_COPILOT_CLI) {
    return "";
  }

  return findCopilotCliSessionContentOrEmpty(resolveCopilotTranscriptPath(homedir), cwd);
}

function resolveTranscriptContent(platform, transcriptFromPath, codexContent, copilotCliContent) {
  if (platform === PLATFORM_COPILOT_CLI) {
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

function parseTranscriptTurns(transcriptContent, captureMode = CAPTURE_MODE_LITE) {
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
  const now = localNow();

  if (assistantContents.length < 1) {
    return now;
  }

  assistantContents.forEach((content) => {
    appendToDaily(vaultPath, subfolder, now.date, buildAssistantReplyEntry(content, now.time));
  });

  return now;
}

function sanitizeTranscriptContent(content, shouldCompress) {
  const sanitizedContent = stripVTControlCharacters(stripMemoryTags(content));

  if (!shouldCompress) {
    return sanitizedContent;
  }

  return compressNarrativeText(sanitizedContent);
}

function buildSafeStopTurns(assistantContents) {
  return assistantContents.reduce(
    (state, content) => {
      const sanitizedContent = compressNarrativeText(
        stripVTControlCharacters(stripMemoryTags(content)),
      );

      if (sanitizedContent === EMPTY_STRING) {
        return state;
      }

      const guard = detectSensitiveContent(sanitizedContent);

      if (guard.isSensitive) {
        return {
          rawTurns: state.rawTurns,
          storedTurns: state.storedTurns,
          sensitiveSkippedCount: state.sensitiveSkippedCount + ONE,
        };
      }

      return {
        rawTurns: state.rawTurns.concat([content]),
        storedTurns: state.storedTurns.concat([sanitizedContent]),
        sensitiveSkippedCount: state.sensitiveSkippedCount,
      };
    },
    {
      rawTurns: [],
      storedTurns: [],
      sensitiveSkippedCount: ZERO,
    },
  );
}

function buildTagWarning(tagCount) {
  if (tagCount <= MAX_TAG_STRIP_COUNT) {
    return EMPTY_STRING;
  }

  return `${HOOK_WARNING_TAG_LIMIT_PREFIX}: ${tagCount} tags found${NEWLINE}`;
}

function buildSensitiveSkipWarning(skippedCount) {
  if (skippedCount < ONE) {
    return EMPTY_STRING;
  }

  return `${HOOK_WARNING_SENSITIVE_SKIP_PREFIX}: ${skippedCount} turn(s) skipped${NEWLINE}`;
}

function buildSensitiveReasonWarning(reasons) {
  return `${HOOK_WARNING_SENSITIVE_SKIP_PREFIX}: ${reasons.join(", ")}${NEWLINE}`;
}

function joinWarnings(warnings) {
  return warnings.filter((warning) => warning !== EMPTY_STRING).join(EMPTY_STRING);
}

/**
 * Process session-end and stop hook events and persist sanitized transcript content.
 *
 * @param {string} rawStdin
 * @param {Record<string, unknown>} [runtime]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);

  if (toStringOrEmpty(env[ENV_KEY_INVOKED_BY]) !== "") {
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

    if (normalizedHookEventName === HOOK_EVENT_STOP) {
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
      const totalTagCount = stopAssistantContents.reduce(
        (sum, content) => sum + countMemoryTags(content),
        ZERO,
      );
      const safeStopTurns = buildSafeStopTurns(stopAssistantContents);
      const tagWarning = buildTagWarning(totalTagCount);
      const sensitiveWarning = buildSensitiveSkipWarning(safeStopTurns.sensitiveSkippedCount);
      const stopWarnings = joinWarnings([tagWarning, sensitiveWarning]);

      const stopNow = writeAssistantTurns(
        resolvedConfig.vaultPath,
        resolvedConfig.subfolder,
        safeStopTurns.storedTurns,
      );

      if (safeStopTurns.storedTurns.length > ZERO) {
        recordCaptureMetrics(
          resolvedConfig.vaultPath,
          resolvedConfig.subfolder,
          HOOK_EVENT_STOP,
          `${stopNow.date}T${stopNow.time}`,
          safeStopTurns.rawTurns.join(NEWLINE),
          safeStopTurns.storedTurns.join(NEWLINE),
        );
      }

      const nextTurnCount = calculateNextTurnCount(
        stopSelection.shouldAppendPayloadAssistant,
        turns,
        lastCount,
      );
      const updatedState = setTranscriptTurnCount(stopCaptureState, sessionIdRaw, nextTurnCount);
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, updatedState);
      const stopResult = buildSuccessResult();

      if (stopWarnings !== EMPTY_STRING) {
        return { ...stopResult, stderr: stopWarnings };
      }

      return stopResult;
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

    const totalTagCount = filteredTurns.reduce(
      (sum, turn) => sum + countMemoryTags(turn.content),
      ZERO,
    );
    const rawTranscriptMarkdown = renderTurnsAsMarkdown(filteredTurns);
    const sanitizedTurns = filteredTurns
      .map((turn) => ({
        ...turn,
        content: sanitizeTranscriptContent(turn.content, turn.role === TRANSCRIPT_ROLE_ASSISTANT),
      }))
      .filter((turn) => turn.content !== EMPTY_STRING);

    if (sanitizedTurns.length < 1) {
      return buildSuccessResult();
    }

    const fullTranscriptMarkdown = renderTurnsAsMarkdown(sanitizedTurns);
    const fullTranscriptGuard = detectSensitiveContent(fullTranscriptMarkdown);
    const tagWarning = buildTagWarning(totalTagCount);

    if (fullTranscriptGuard.isSensitive) {
      const sensitiveWarning = buildSensitiveReasonWarning(fullTranscriptGuard.reasons);
      const fullWarnings = joinWarnings([tagWarning, sensitiveWarning]);
      const sensitiveResult = buildSuccessResult();

      return { ...sensitiveResult, stderr: fullWarnings };
    }

    const today = localNow().date;
    const sessionId = firstNonEmptyString([sessionIdRaw, UNKNOWN_LABEL]);
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
    recordCaptureMetrics(
      resolvedConfig.vaultPath,
      resolvedConfig.subfolder,
      HOOK_EVENT_SESSION_END_KEBAB,
      `${now.date}T${now.time}`,
      rawTranscriptMarkdown,
      fullTranscriptMarkdown,
    );
    const fullResult = buildSuccessResult();

    if (tagWarning !== EMPTY_STRING) {
      return { ...fullResult, stderr: tagWarning };
    }

    return fullResult;
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
