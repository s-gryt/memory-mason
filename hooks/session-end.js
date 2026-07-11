#!/usr/bin/env node
/**
 * This module handles session end logic.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseJsonInput, detectPlatform } = require("./lib/config/config");
const { buildCommandErrorResult, formatErrorMessage } = require("./lib/cli/cli");
const {
  parseJsonlTranscript,
  filterMmTurns,
  renderTurnsAsMarkdown,
  normalizeTranscriptText,
} = require("./lib/capture/transcript");
const {
  buildSessionHeader,
  buildAssistantReplyEntry,
  localNow,
  buildSessionContext,
} = require("./lib/vault/vault");
const { appendToDaily } = require("./lib/vault/writer");
const { recordCaptureMetrics } = require("./lib/state/state");
const {
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getTranscriptTurnCount,
  setTranscriptTurnCount,
  getMmSuppressed,
  isExchangeOpen,
  closeExchange,
} = require("./lib/capture/capture-state");
const { CAPTURE_MODE_LITE, ENV_KEY_INVOKED_BY } = require("./lib/config/constants");
const { HOOK_EVENT_STOP } = require("./lib/hook/constants");
const { DUPLICATE_CAPTURE_WINDOW_MS } = require("./lib/capture/constants");
const { UTF8_ENCODING } = require("./lib/shared/constants");
const { HOOK_WARNING_SENSITIVE_SKIP_PREFIX } = require("./lib/filter/constants");
const { PLATFORM_COPILOT_CLI, PLATFORM_CODEX } = require("./lib/config/platforms");
const { UNKNOWN_LABEL } = require("./lib/vault/markdown-labels");
const { stripMemoryTags, countMemoryTags } = require("./lib/filter/tag-stripper");
const { detectSensitiveContent } = require("./lib/filter/sensitive-guard");
const { compressNarrativeText } = require("./lib/economics/compress");
const { HOOK_EVENT_SESSION_END_KEBAB } = require("./lib/hook/hook-events");
const {
  buildTagWarning,
  buildWarningsResult,
  HOOK_WARNING_FILTER_FALLBACK_PREFIX,
} = require("./lib/hook/capture-ops");
const { TRANSCRIPT_ROLE_ASSISTANT } = require("./lib/capture/transcript-labels");
const { stripVTControlCharacters } = require("node:util");
const {
  readStdin,
  toStringOrEmpty,
  firstNonEmptyString: firstNonEmptyStringFromRuntime,
  resolveTranscriptPath,
  resolveRuntimeContext,
  resolveInputCwd,
  resolveRuntimeConfig,
  buildSuccessResult,
  runStdinMain,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
} = require("./lib/hook/hook-runtime");

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

function resolveSessionTranscript(input, platform, homedir, sessionIdRaw, cwd) {
  const transcriptPath = resolveTranscriptPath(input);
  const transcriptFromPath = readTranscriptFromPath(transcriptPath);
  return discoverTranscriptContent(platform, transcriptFromPath, homedir, sessionIdRaw, cwd);
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

function writeAssistantTurns(vaultPath, subfolder, assistantContents, session, captureState) {
  const now = localNow();

  if (assistantContents.length < 1) {
    return now;
  }

  const safeSession =
    session !== null && typeof session === "object" && !Array.isArray(session)
      ? session
      : buildSessionContext("", "", "");
  const exchangeOpen =
    safeSession.sessionId !== "" && isExchangeOpen(captureState, safeSession.sessionId);

  assistantContents.forEach((content) => {
    appendToDaily(vaultPath, subfolder, now.date, buildAssistantReplyEntry(content, now.time), {
      session: safeSession,
      exchangeOpen,
    });
  });

  return now;
}

function sanitizeTranscriptContent(content, shouldCompress, minimize) {
  const sanitizedContent = stripVTControlCharacters(stripMemoryTags(content));

  if (!shouldCompress || !minimize) {
    return {
      content: sanitizedContent,
      filterWarning: EMPTY_STRING,
    };
  }

  try {
    return {
      content: compressNarrativeText(sanitizedContent),
      filterWarning: EMPTY_STRING,
    };
  } catch (error) {
    return {
      content: sanitizedContent,
      filterWarning: buildFilterFallbackWarning(error),
    };
  }
}

function buildSafeStopTurns(assistantContents, minimize) {
  const state = {
    rawTurns: [],
    storedTurns: [],
    sensitiveSkippedCount: ZERO,
    filterWarning: EMPTY_STRING,
  };

  for (const content of assistantContents) {
    const sanitizedTurn = sanitizeTranscriptContent(content, true, minimize);
    const sanitizedContent = sanitizedTurn.content;
    state.filterWarning = mergeWarning(state.filterWarning, sanitizedTurn.filterWarning);

    if (sanitizedContent === EMPTY_STRING) {
      continue;
    }

    const guard = detectSensitiveContent(sanitizedContent);
    if (guard.isSensitive) {
      state.sensitiveSkippedCount += ONE;
      continue;
    }

    state.rawTurns.push(content);
    state.storedTurns.push(sanitizedContent);
  }

  return state;
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

function buildFilterFallbackWarning(error) {
  return `${HOOK_WARNING_FILTER_FALLBACK_PREFIX}: ${formatErrorMessage(error)}${NEWLINE}`;
}

function mergeWarning(existingWarning, nextWarning) {
  if (nextWarning === EMPTY_STRING || existingWarning.includes(nextWarning)) {
    return existingWarning;
  }

  return `${existingWarning}${nextWarning}`;
}

function trySaveCaptureState(vaultPath, subfolder, state) {
  try {
    saveCaptureState(vaultPath, subfolder, state);
  } catch (error) {
    process.stderr.write(
      `[memory-mason] failed to persist closed exchange state: ${formatErrorMessage(error)}${NEWLINE}`,
    );
  }
}

function captureStopPath(input, platform, cwd, homedir, resolvedConfig, captureMode, sessionIdRaw) {
  if (sessionIdRaw === "") {
    return buildSuccessResult();
  }

  const stopCaptureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  if (getMmSuppressed(stopCaptureState)) {
    return buildSuccessResult();
  }

  const transcriptContent = resolveSessionTranscript(input, platform, homedir, sessionIdRaw, cwd);

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
  const safeStopTurns = buildSafeStopTurns(stopAssistantContents, resolvedConfig.minimize === true);
  const tagWarning = buildTagWarning(totalTagCount);
  const sensitiveWarning = buildSensitiveSkipWarning(safeStopTurns.sensitiveSkippedCount);
  const stopWarnings = joinWarnings([tagWarning, sensitiveWarning, safeStopTurns.filterWarning]);

  const stopSession = buildSessionContext(sessionIdRaw, platform, cwd);
  const closedExchangeState = closeExchange(stopCaptureState, sessionIdRaw);
  let stopNow;
  try {
    stopNow = writeAssistantTurns(
      resolvedConfig.vaultPath,
      resolvedConfig.subfolder,
      safeStopTurns.storedTurns,
      stopSession,
      stopCaptureState,
    );
  } catch (error) {
    trySaveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, closedExchangeState);
    throw error;
  }

  const nextTurnCount = calculateNextTurnCount(
    stopSelection.shouldAppendPayloadAssistant,
    turns,
    lastCount,
  );
  const updatedState = setTranscriptTurnCount(closedExchangeState, sessionIdRaw, nextTurnCount);
  trySaveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, updatedState);

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
  return buildWarningsResult(stopWarnings);
}

function captureSessionEndPath(
  input,
  platform,
  cwd,
  homedir,
  resolvedConfig,
  captureMode,
  sessionIdRaw,
) {
  const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  if (getMmSuppressed(captureState)) {
    return buildSuccessResult();
  }
  const transcriptContent = resolveSessionTranscript(input, platform, homedir, sessionIdRaw, cwd);

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
  const sanitizedTurnData = filteredTurns.reduce(
    (state, turn) => {
      const sanitizedTurn = sanitizeTranscriptContent(
        turn.content,
        turn.role === TRANSCRIPT_ROLE_ASSISTANT,
        resolvedConfig.minimize === true,
      );

      if (sanitizedTurn.content === EMPTY_STRING) {
        return {
          turns: state.turns,
          filterWarning: mergeWarning(state.filterWarning, sanitizedTurn.filterWarning),
        };
      }

      return {
        turns: state.turns.concat([
          {
            ...turn,
            content: sanitizedTurn.content,
          },
        ]),
        filterWarning: mergeWarning(state.filterWarning, sanitizedTurn.filterWarning),
      };
    },
    {
      turns: [],
      filterWarning: EMPTY_STRING,
    },
  );
  const sanitizedTurns = sanitizedTurnData.turns;

  /* v8 ignore else -- guard-clause return, else-fallthrough exercised by other suite tests */
  if (sanitizedTurns.length < 1) {
    return buildSuccessResult();
  }

  const fullTranscriptMarkdown = renderTurnsAsMarkdown(sanitizedTurns);
  const fullTranscriptGuard = detectSensitiveContent(fullTranscriptMarkdown);
  const tagWarning = buildTagWarning(totalTagCount);

  if (fullTranscriptGuard.isSensitive) {
    const sensitiveWarning = buildSensitiveReasonWarning(fullTranscriptGuard.reasons);
    const fullWarnings = joinWarnings([
      tagWarning,
      sensitiveWarning,
      sanitizedTurnData.filterWarning,
    ]);
    return buildWarningsResult(fullWarnings);
  }

  const today = localNow().date;
  const sessionId = firstNonEmptyString([sessionIdRaw, UNKNOWN_LABEL]);
  const source = firstNonEmptyString([toStringOrEmpty(input.source), platform]);
  const captureRecord = buildCaptureRecord(sessionId, source, fullTranscriptMarkdown, Date.now());

  if (isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS)) {
    return buildSuccessResult();
  }

  const now = localNow();
  const capturedAt = `${now.date}T${now.time}`;
  const sessionHeader = buildSessionHeader(sessionId, source, capturedAt);
  const sessionEndSession = buildSessionContext(sessionId, platform, cwd);
  const exchangeOpen = sessionIdRaw !== "" && isExchangeOpen(captureState, sessionIdRaw);
  const closedState =
    sessionIdRaw !== "" ? closeExchange(captureState, sessionIdRaw) : captureState;
  try {
    appendToDaily(
      resolvedConfig.vaultPath,
      resolvedConfig.subfolder,
      today,
      sessionHeader + fullTranscriptMarkdown,
      { session: sessionEndSession, exchangeOpen },
    );
  } catch (error) {
    trySaveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, closedState);
    throw error;
  }
  const nextCaptureState = {
    ...closedState,
    lastCapture: captureRecord,
  };
  trySaveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, nextCaptureState);
  recordCaptureMetrics(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    HOOK_EVENT_SESSION_END_KEBAB,
    capturedAt,
    rawTranscriptMarkdown,
    fullTranscriptMarkdown,
  );

  return buildWarningsResult(joinWarnings([tagWarning, sanitizedTurnData.filterWarning]));
}

function run(rawStdin, runtime = {}) {
  const runtimeContext = resolveRuntimeContext(runtime);
  const env = runtimeContext.env;
  const fallbackCwd = runtimeContext.fallbackCwd;
  const homedir = runtimeContext.homedir;
  const wasInvokedByTool = toStringOrEmpty(env[ENV_KEY_INVOKED_BY]) !== "";

  /* v8 ignore else -- guard-clause return, else-fallthrough exercised by other suite tests */
  if (wasInvokedByTool) {
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

    const syncDisabled = resolvedConfig.sync === false;

    /* v8 ignore else -- guard-clause return, else-fallthrough exercised by other suite tests */
    if (syncDisabled) {
      return buildSuccessResult();
    }

    const captureMode = resolvedConfig.captureMode;

    const sessionIdRaw = resolveSessionId(input);

    if (captureMode === CAPTURE_MODE_LITE && normalizedHookEventName !== HOOK_EVENT_STOP) {
      return buildSuccessResult();
    }

    if (normalizedHookEventName === HOOK_EVENT_STOP) {
      return captureStopPath(
        input,
        platform,
        cwd,
        homedir,
        resolvedConfig,
        captureMode,
        sessionIdRaw,
      );
    }

    return captureSessionEndPath(
      input,
      platform,
      cwd,
      homedir,
      resolvedConfig,
      captureMode,
      sessionIdRaw,
    );
  } catch (error) {
    return buildCommandErrorResult(error);
  }
}

function main(runtime = {}) {
  return runStdinMain(runtime, run);
}

/* v8 ignore next 3 -- CLI entrypoint guard, exercised only via subprocess spawn */
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
  sanitizeTranscriptContent,
  buildFilterFallbackWarning,
  mergeWarning,
  writeAssistantTurns,
  run,
  main,
};
