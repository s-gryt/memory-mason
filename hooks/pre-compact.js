#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { parseJsonInput } = require("./lib/config");
const { buildCommandErrorResult } = require("./lib/cli");
const { buildFullTranscript } = require("./lib/transcript");
const { buildSessionHeader, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
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
} = require("./lib/constants");

function firstNonEmptyString(values) {
  if (!Array.isArray(values)) {
    throw new Error("values must be an array");
  }
  return firstNonEmptyStringFromRuntime(values);
}

function shouldSkipForInvoker(env) {
  return toStringOrEmpty(env.MEMORY_MASON_INVOKED_BY) !== "";
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
    "unknown",
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

function persistCapture(
  resolvedConfig,
  today,
  sessionHeader,
  fullTranscript,
  captureState,
  captureRecord,
) {
  appendToDaily(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    today,
    sessionHeader + fullTranscript.markdown,
  );
  saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, {
    ...captureState,
    lastCapture: captureRecord,
  });
}

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

    const transcriptContent = fs.readFileSync(transcriptPath, "utf-8");
    const fullTranscript = buildFullTranscript(transcriptContent, resolvedConfig.captureMode);

    if (shouldSkipShortTranscript(fullTranscript)) {
      return buildSuccessResult();
    }

    const captureTimestamp = buildCaptureTimestamp();
    const sessionId = resolveSessionId(input);
    const captureRecord = buildCaptureRecord(
      sessionId,
      "pre-compact",
      fullTranscript.markdown,
      Date.now(),
    );

    if (buildDuplicateDecision(captureState, captureRecord)) {
      return buildSuccessResult();
    }

    const sessionHeader = buildSessionHeader(sessionId, "pre-compact", captureTimestamp.iso);
    persistCapture(
      resolvedConfig,
      captureTimestamp.today,
      sessionHeader,
      fullTranscript,
      captureState,
      captureRecord,
    );
    return buildSuccessResult();
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
