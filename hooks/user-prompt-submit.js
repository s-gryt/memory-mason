#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { parseJsonInput, detectPlatform } = require("./lib/config");
const { buildCommandErrorResult } = require("./lib/cli");
const { buildDailyEntry, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
const { extractPromptEntry, isMmCommand } = require("./lib/prompt");
const { parseJsonlTranscript } = require("./lib/transcript");
const {
  readStdin,
  toStringOrEmpty,
  firstNonEmptyString,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  resolveRuntimeEnv,
  resolveFallbackCwd,
  resolveRuntimeHomedir,
  resolveInputCwd,
  resolveRuntimeConfig,
  buildSuccessResult,
  runStdinMain,
} = require("./lib/hook-runtime");
const {
  loadCaptureState,
  saveCaptureState,
  setTranscriptTurnCount,
  getMmSuppressed,
  setMmSuppressed,
} = require("./lib/capture-state");
const { UTF8_ENCODING } = require("./lib/constants");

function resolvePromptPayload(rawStdin) {
  const input = parseJsonInput(rawStdin);
  const platform = detectPlatform(input);
  const promptEntry = extractPromptEntry(platform, input);
  return {
    input,
    promptEntry,
  };
}

function buildPromptStateAnchors(input) {
  return {
    transcriptPath: firstNonEmptyString([
      toStringOrEmpty(input.transcript_path),
      toStringOrEmpty(input.transcriptPath),
    ]),
    sessionId: firstNonEmptyString([
      toStringOrEmpty(input.session_id),
      toStringOrEmpty(input.sessionId),
    ]),
  };
}

function buildCaptureTimestamp() {
  const now = localNow();
  return {
    today: now.date,
    timestamp: now.time,
  };
}

function buildRunPlan(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);
  const payload = resolvePromptPayload(rawStdin);
  const cwd = resolveInputCwd(payload.input, fallbackCwd);
  const anchors = buildPromptStateAnchors(payload.input);
  const captureTimestamp = buildCaptureTimestamp();
  return {
    env,
    homedir,
    cwd,
    input: payload.input,
    promptEntry: payload.promptEntry,
    transcriptPath: anchors.transcriptPath,
    sessionId: anchors.sessionId,
    today: captureTimestamp.today,
    timestamp: captureTimestamp.timestamp,
  };
}

function shouldUpdateTranscriptState(transcriptPath, sessionId) {
  return transcriptPath !== "" && sessionId !== "" && fs.existsSync(transcriptPath);
}

function updateTranscriptState(resolvedConfig, transcriptPath, sessionId) {
  const transcriptContent = fs.readFileSync(transcriptPath, UTF8_ENCODING);
  const turns = parseJsonlTranscript(transcriptContent);
  const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const updatedState = setTranscriptTurnCount(captureState, sessionId, turns.length);
  saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, updatedState);
}

function persistPromptSubmission(plan, resolvedConfig) {
  if (shouldUpdateTranscriptState(plan.transcriptPath, plan.sessionId)) {
    updateTranscriptState(resolvedConfig, plan.transcriptPath, plan.sessionId);
  }

  const dailyEntry = buildDailyEntry(
    plan.promptEntry.entryName,
    plan.promptEntry.text,
    plan.timestamp,
  );
  appendToDaily(resolvedConfig.vaultPath, resolvedConfig.subfolder, plan.today, dailyEntry);
}

function run(rawStdin, runtime = {}) {
  try {
    const plan = buildRunPlan(rawStdin, runtime);

    if (plan.promptEntry.text === "") {
      return buildSuccessResult();
    }

    const resolvedConfig = module.exports.resolveRuntimeConfig(plan.cwd, plan.homedir);

    if (resolvedConfig.sync === false) {
      return buildSuccessResult();
    }

    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);

    if (isMmCommand(plan.promptEntry.text)) {
      const suppressedState = setMmSuppressed(captureState, true);
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, suppressedState);
      return buildSuccessResult();
    }

    if (getMmSuppressed(captureState)) {
      const unsuppressedState = setMmSuppressed(captureState, false);
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, unsuppressedState);
    }

    persistPromptSubmission(plan, resolvedConfig);
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
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  resolveRuntimeConfig,
  run,
  main,
};

/* c8 ignore next 3 */
if (require.main === module) {
  main();
}
