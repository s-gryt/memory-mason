#!/usr/bin/env node
/**
 * This module handles pre compact logic.
 */
"use strict";

const fs = require("node:fs");
const { parseJsonInput, detectPlatform } = require("./lib/config/config");
const { buildCommandErrorResult } = require("./lib/cli/cli");
const {
  parseJsonlTranscript,
  renderTurnsAsMarkdown,
  filterMmTurns,
} = require("./lib/capture/transcript");
const { buildSessionHeader, buildSessionContext } = require("./lib/vault/vault");
const { appendToDaily } = require("./lib/vault/writer");
const { recordCaptureMetrics } = require("./lib/state/state");
const {
  buildCaptureTimestamp,
  buildTagWarning,
  buildWarningsResult,
  HOOK_WARNING_FILTER_FALLBACK_PREFIX,
} = require("./lib/hook/capture-ops");
const hookRuntime = require("./lib/hook/hook-runtime");
const {
  buildSuccessResult,
  firstNonEmptyString: firstNonEmptyStringFromRuntime,
  readStdin,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  resolveInputCwd,
  resolveRuntimeConfig,
  resolveTranscriptPath,
  resolveRuntimeContext,
  runStdinMain,
  toStringOrEmpty,
} = hookRuntime;
const {
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getMmSuppressed,
  closeExchange,
  isExchangeOpen,
} = require("./lib/capture/capture-state");
const { CAPTURE_MODE_LITE, ENV_KEY_INVOKED_BY } = require("./lib/config/constants");
const { PRE_COMPACT_MIN_TURNS } = require("./lib/hook/constants");
const { DUPLICATE_CAPTURE_WINDOW_MS } = require("./lib/capture/constants");
const { UTF8_ENCODING } = require("./lib/shared/constants");
const { HOOK_EVENT_PRE_COMPACT_KEBAB } = require("./lib/hook/hook-events");
const { UNKNOWN_LABEL } = require("./lib/vault/markdown-labels");
const { stripMemoryTags, countMemoryTags } = require("./lib/filter/tag-stripper");
const { compressNarrativeText } = require("./lib/economics/compress");
const { detectSensitiveContent } = require("./lib/filter/sensitive-guard");
const { HOOK_WARNING_SENSITIVE_SKIP_PREFIX } = require("./lib/filter/constants");
const { TRANSCRIPT_ROLE_ASSISTANT } = require("./lib/capture/transcript-labels");
const { stripVTControlCharacters } = require("node:util");

const EMPTY_STRING = "";
const NEWLINE = "\n";

function firstNonEmptyString(values) {
  if (Array.isArray(values)) {
    return firstNonEmptyStringFromRuntime(values);
  }
  throw new Error("values must be an array");
}

function shouldSkipForInvoker(env) {
  return toStringOrEmpty(env[ENV_KEY_INVOKED_BY]) !== "";
}

function shouldSkipMissingTranscript(transcriptPath) {
  return transcriptPath === "" || !fs.existsSync(transcriptPath);
}

function shouldSkipShortTranscript(fullTranscript) {
  return fullTranscript.turnCount < PRE_COMPACT_MIN_TURNS;
}

function resolveSessionId(input) {
  return firstNonEmptyString([
    toStringOrEmpty(input.session_id),
    toStringOrEmpty(input.sessionId),
    UNKNOWN_LABEL,
  ]);
}

function buildDuplicateDecision(captureState, captureRecord) {
  return isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS);
}

function sanitizeTranscriptBaseContent(content) {
  return stripVTControlCharacters(stripMemoryTags(content));
}

function buildCompressionFallbackWarning(failureCount) {
  if (!Number.isInteger(failureCount) || failureCount < 1) {
    return EMPTY_STRING;
  }

  return `${HOOK_WARNING_FILTER_FALLBACK_PREFIX}: ${failureCount} assistant turn(s) failed compression; using sanitized originals${NEWLINE}`;
}

function parseTranscriptTurnsForSanitization(transcriptContent, captureMode) {
  if (transcriptContent === EMPTY_STRING) {
    return [];
  }

  return parseJsonlTranscript(transcriptContent, captureMode);
}

function sanitizeTurnsBaseContent(turns) {
  return turns
    .map((turn) => ({
      ...turn,
      content: sanitizeTranscriptBaseContent(turn.content),
    }))
    .filter((turn) => turn.content !== EMPTY_STRING);
}

function compressAssistantTurns(turns) {
  return turns.reduce(
    (state, turn) => {
      if (turn.role !== TRANSCRIPT_ROLE_ASSISTANT) {
        return {
          turns: state.turns.concat([turn]),
          failureCount: state.failureCount,
        };
      }

      try {
        return {
          turns: state.turns.concat([
            {
              ...turn,
              content: compressNarrativeText(turn.content),
            },
          ]),
          failureCount: state.failureCount,
        };
      } catch (_error) {
        return {
          turns: state.turns.concat([turn]),
          failureCount: state.failureCount + 1,
        };
      }
    },
    { turns: [], failureCount: 0 },
  );
}

function buildSanitizedTranscript(transcriptContent, captureMode, minimize) {
  const turns = filterMmTurns(parseTranscriptTurnsForSanitization(transcriptContent, captureMode));

  if (turns.length === 0) {
    return {
      markdown: EMPTY_STRING,
      rawMarkdown: EMPTY_STRING,
      filterWarning: EMPTY_STRING,
      turnCount: 0,
    };
  }

  const rawMarkdown = renderTurnsAsMarkdown(turns);
  const baseSanitizedTurns = sanitizeTurnsBaseContent(turns);

  if (baseSanitizedTurns.length === 0) {
    return {
      markdown: EMPTY_STRING,
      rawMarkdown,
      filterWarning: EMPTY_STRING,
      turnCount: turns.length,
    };
  }

  const baseSanitizedMarkdown = renderTurnsAsMarkdown(baseSanitizedTurns);

  if (!minimize) {
    return {
      markdown: baseSanitizedMarkdown,
      rawMarkdown,
      filterWarning: EMPTY_STRING,
      turnCount: turns.length,
    };
  }

  const compressed = compressAssistantTurns(baseSanitizedTurns);
  const sanitizedTurns = compressed.turns.filter((turn) => turn.content.trim() !== EMPTY_STRING);

  if (sanitizedTurns.length === 0) {
    return {
      markdown: baseSanitizedMarkdown,
      rawMarkdown,
      filterWarning: `${HOOK_WARNING_FILTER_FALLBACK_PREFIX}: all assistant turns compressed to empty; using sanitized originals${NEWLINE}`,
      turnCount: turns.length,
    };
  }

  return {
    markdown: renderTurnsAsMarkdown(sanitizedTurns),
    rawMarkdown,
    filterWarning: buildCompressionFallbackWarning(compressed.failureCount),
    turnCount: turns.length,
  };
}

function persistCapture(
  resolvedConfig,
  today,
  sessionHeader,
  rawTranscriptMarkdown,
  transcriptMarkdown,
  captureState,
  captureRecord,
  capturedAt,
  session,
) {
  const hasValidSession =
    session !== null &&
    typeof session === "object" &&
    typeof session.sessionId === "string" &&
    session.sessionId !== "";
  const closedState = hasValidSession
    ? closeExchange(captureState, session.sessionId)
    : captureState;
  const exchangeOpen = hasValidSession && isExchangeOpen(captureState, session.sessionId);
  appendToDaily(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    today,
    sessionHeader + transcriptMarkdown,
    { session, exchangeOpen },
  );
  saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, {
    ...closedState,
    lastCapture: captureRecord,
  });
  recordCaptureMetrics(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    HOOK_EVENT_PRE_COMPACT_KEBAB,
    capturedAt,
    rawTranscriptMarkdown,
    transcriptMarkdown,
  );
}

function run(rawStdin, runtime = {}) {
  const { env, fallbackCwd, homedir } = resolveRuntimeContext(runtime);

  if (shouldSkipForInvoker(env)) {
    return buildSuccessResult();
  }

  try {
    const input = parseJsonInput(rawStdin);
    const transcriptPath = resolveTranscriptPath(input);

    if (shouldSkipMissingTranscript(transcriptPath)) {
      return buildSuccessResult();
    }

    const cwd = resolveInputCwd(input, fallbackCwd);
    const resolvedConfig = resolveRuntimeConfig(cwd, homedir);
    const syncDisabled = resolvedConfig.sync === false;

    if (syncDisabled) {
      return buildSuccessResult();
    }

    if (resolvedConfig.captureMode === CAPTURE_MODE_LITE) {
      return buildSuccessResult();
    }

    const captureStatePath = [resolvedConfig.vaultPath, resolvedConfig.subfolder];
    const captureState = loadCaptureState(captureStatePath[0], captureStatePath[1]);

    if (getMmSuppressed(captureState)) {
      return buildSuccessResult();
    }

    const transcriptContent = fs.readFileSync(transcriptPath, UTF8_ENCODING);
    const fullTranscript = buildSanitizedTranscript(
      transcriptContent,
      resolvedConfig.captureMode,
      resolvedConfig.minimize === true,
    );
    const tagCount = countMemoryTags(fullTranscript.rawMarkdown);
    const sanitizedMarkdown = fullTranscript.markdown;
    const tagWarning = buildTagWarning(tagCount);
    const filterWarning = fullTranscript.filterWarning;

    if (shouldSkipShortTranscript(fullTranscript)) {
      return buildWarningsResult(tagWarning, filterWarning);
    }

    const captureTimestamp = buildCaptureTimestamp();
    const sessionId = resolveSessionId(input);
    const captureRecord = buildCaptureRecord(
      sessionId,
      HOOK_EVENT_PRE_COMPACT_KEBAB,
      sanitizedMarkdown,
      Date.now(),
    );

    if (buildDuplicateDecision(captureState, captureRecord)) {
      return buildWarningsResult(tagWarning, filterWarning);
    }

    if (sanitizedMarkdown === EMPTY_STRING) {
      return buildWarningsResult(tagWarning, filterWarning);
    }

    const sensitiveCheck = detectSensitiveContent(sanitizedMarkdown);
    if (sensitiveCheck.isSensitive) {
      const sensitiveWarning = `${HOOK_WARNING_SENSITIVE_SKIP_PREFIX}: ${sensitiveCheck.reasons.join(", ")}${NEWLINE}`;
      return buildWarningsResult(tagWarning, filterWarning, sensitiveWarning);
    }

    const platform = detectPlatform(input);
    const session = buildSessionContext(sessionId, platform, cwd);
    const sessionHeader = buildSessionHeader(
      sessionId,
      HOOK_EVENT_PRE_COMPACT_KEBAB,
      captureTimestamp.iso,
    );
    persistCapture(
      resolvedConfig,
      captureTimestamp.today,
      sessionHeader,
      fullTranscript.rawMarkdown,
      sanitizedMarkdown,
      captureState,
      captureRecord,
      captureTimestamp.iso,
      session,
    );
    return buildWarningsResult(tagWarning, filterWarning);
  } catch (error) {
    const failure = buildCommandErrorResult(error);
    return failure;
  }
}

const main = (runtime = {}) => runStdinMain(runtime, run);

module.exports = {
  readStdin,
  firstNonEmptyString,
  resolveTranscriptPath,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  persistCapture,
  run,
  main,
};

/* v8 ignore next 3 -- CLI entrypoint guard, exercised only via subprocess spawn */
if (require.main === module) {
  main();
}
