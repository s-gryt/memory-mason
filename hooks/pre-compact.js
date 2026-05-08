#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { parseJsonInput } = require("./lib/config");
const { buildCommandErrorResult, formatErrorMessage } = require("./lib/cli");
const { parseJsonlTranscript, renderTurnsAsMarkdown } = require("./lib/transcript");
const { buildSessionHeader, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
const { recordCaptureMetrics } = require("./lib/state");
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
const {
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getMmSuppressed,
} = require("./lib/capture-state");
const {
  CAPTURE_MODE_LITE,
  PRE_COMPACT_MIN_TURNS,
  DUPLICATE_CAPTURE_WINDOW_MS,
  UTF8_ENCODING,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
} = require("./lib/constants");
const { HOOK_EVENT_PRE_COMPACT_KEBAB } = require("./lib/hook-events");
const { UNKNOWN_LABEL } = require("./lib/markdown-labels");
const { ENV_KEY_INVOKED_BY } = require("./lib/config-keys");
const { stripMemoryTags, countMemoryTags, MAX_TAG_STRIP_COUNT } = require("./lib/tag-stripper");
const { compressNarrativeText } = require("./lib/compress");
const { detectSensitiveContent } = require("./lib/sensitive-guard");
const { HOOK_WARNING_SENSITIVE_SKIP_PREFIX } = require("./lib/constants");
const { TRANSCRIPT_ROLE_ASSISTANT } = require("./lib/transcript-labels");
const { stripVTControlCharacters } = require("node:util");

const EMPTY_STRING = "";
const NEWLINE = "\n";
const HOOK_WARNING_FILTER_FALLBACK_PREFIX =
  "[memory-mason] capture filter failed; using uncompressed sanitized transcript";

function firstNonEmptyString(values) {
  if (!Array.isArray(values)) {
    throw new Error("values must be an array");
  }
  return firstNonEmptyStringFromRuntime(values);
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

function buildCaptureTimestamp() {
  const now = localNow();
  return {
    iso: `${now.date}T${now.time}`,
    today: now.date,
  };
}

function buildDuplicateDecision(captureState, captureRecord) {
  return isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS);
}

function buildTagWarning(tagCount) {
  if (tagCount <= MAX_TAG_STRIP_COUNT) {
    return EMPTY_STRING;
  }

  return `${HOOK_WARNING_TAG_LIMIT_PREFIX}: ${tagCount} tags found${NEWLINE}`;
}

function buildFilterFallbackWarning(error) {
  return `${HOOK_WARNING_FILTER_FALLBACK_PREFIX}: ${formatErrorMessage(error)}${NEWLINE}`;
}

function sanitizeTranscriptBaseContent(content) {
  return stripVTControlCharacters(stripMemoryTags(content));
}

function buildSanitizedTranscript(transcriptContent, captureMode) {
  if (transcriptContent === EMPTY_STRING) {
    return {
      markdown: EMPTY_STRING,
      rawMarkdown: EMPTY_STRING,
      filterWarning: EMPTY_STRING,
      turnCount: 0,
    };
  }

  const turns = parseJsonlTranscript(transcriptContent, captureMode);

  if (turns.length === 0) {
    return {
      markdown: EMPTY_STRING,
      rawMarkdown: EMPTY_STRING,
      filterWarning: EMPTY_STRING,
      turnCount: 0,
    };
  }

  const rawMarkdown = renderTurnsAsMarkdown(turns);
  const baseSanitizedTurns = turns
    .map((turn) => ({
      ...turn,
      content: sanitizeTranscriptBaseContent(turn.content),
    }))
    .filter((turn) => turn.content !== EMPTY_STRING);

  if (baseSanitizedTurns.length === 0) {
    return {
      markdown: EMPTY_STRING,
      rawMarkdown,
      filterWarning: EMPTY_STRING,
      turnCount: turns.length,
    };
  }

  const baseSanitizedMarkdown = renderTurnsAsMarkdown(baseSanitizedTurns);

  try {
    const sanitizedTurns = baseSanitizedTurns
      .map((turn) => ({
        ...turn,
        content:
          turn.role === TRANSCRIPT_ROLE_ASSISTANT
            ? compressNarrativeText(turn.content)
            : turn.content,
      }))
      .filter((turn) => turn.content !== EMPTY_STRING);

    if (sanitizedTurns.length === 0) {
      return {
        markdown: EMPTY_STRING,
        rawMarkdown,
        filterWarning: EMPTY_STRING,
        turnCount: turns.length,
      };
    }

    return {
      markdown: renderTurnsAsMarkdown(sanitizedTurns),
      rawMarkdown,
      filterWarning: EMPTY_STRING,
      turnCount: turns.length,
    };
  } catch (error) {
    return {
      markdown: baseSanitizedMarkdown,
      rawMarkdown,
      filterWarning: buildFilterFallbackWarning(error),
      turnCount: turns.length,
    };
  }
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
) {
  appendToDaily(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    today,
    sessionHeader + transcriptMarkdown,
  );
  saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, {
    ...captureState,
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

/**
 * Capture pre-compact transcript excerpts into the vault after sanitation and dedupe checks.
 *
 * @param {string} rawStdin
 * @param {Record<string, unknown>} [runtime]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);

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

    if (resolvedConfig.sync === false) {
      return buildSuccessResult();
    }

    if (resolvedConfig.captureMode === CAPTURE_MODE_LITE) {
      return buildSuccessResult();
    }

    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);

    if (getMmSuppressed(captureState)) {
      return buildSuccessResult();
    }

    const transcriptContent = fs.readFileSync(transcriptPath, UTF8_ENCODING);
    const fullTranscript = buildSanitizedTranscript(transcriptContent, resolvedConfig.captureMode);
    const tagCount = countMemoryTags(fullTranscript.rawMarkdown);
    const sanitizedMarkdown = fullTranscript.markdown;
    const tagWarning = buildTagWarning(tagCount);
    const filterWarning = fullTranscript.filterWarning;

    if (shouldSkipShortTranscript(fullTranscript)) {
      const shortResult = buildSuccessResult();

      if (tagWarning !== EMPTY_STRING || filterWarning !== EMPTY_STRING) {
        return { ...shortResult, stderr: `${tagWarning}${filterWarning}` };
      }

      return shortResult;
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
      const duplicateResult = buildSuccessResult();

      if (tagWarning !== EMPTY_STRING || filterWarning !== EMPTY_STRING) {
        return { ...duplicateResult, stderr: `${tagWarning}${filterWarning}` };
      }

      return duplicateResult;
    }

    if (sanitizedMarkdown === EMPTY_STRING) {
      const emptyResult = buildSuccessResult();

      if (tagWarning !== EMPTY_STRING || filterWarning !== EMPTY_STRING) {
        return { ...emptyResult, stderr: `${tagWarning}${filterWarning}` };
      }

      return emptyResult;
    }

    const sensitiveCheck = detectSensitiveContent(sanitizedMarkdown);
    if (sensitiveCheck.isSensitive) {
      const sensitiveWarning = `${HOOK_WARNING_SENSITIVE_SKIP_PREFIX}: ${sensitiveCheck.reasons.join(", ")}${NEWLINE}`;
      const skipResult = buildSuccessResult();
      return { ...skipResult, stderr: `${tagWarning}${filterWarning}${sensitiveWarning}` };
    }

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
    );
    const successResult = buildSuccessResult();

    if (tagWarning !== EMPTY_STRING || filterWarning !== EMPTY_STRING) {
      return { ...successResult, stderr: `${tagWarning}${filterWarning}` };
    }

    return successResult;
  } catch (error) {
    return buildCommandErrorResult(error);
  }
}

function main(runtime = {}) {
  return runStdinMain(runtime, run);
}

module.exports = {
  readStdin,
  firstNonEmptyString,
  resolveTranscriptPath,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  run,
  main,
};

/* c8 ignore next 3 */
if (require.main === module) {
  main();
}
