#!/usr/bin/env node
/**
 * This module handles user prompt submit logic.
 */
"use strict";

const fs = require("node:fs");
const { parseJsonInput, detectPlatform } = require("./lib/config/config");
const { buildCommandErrorResult } = require("./lib/cli/cli");
const { buildDailyEntry } = require("./lib/vault/vault");
const { appendToDaily } = require("./lib/vault/writer");
const { extractPromptEntry, isMmCommand } = require("./lib/prompt/prompt");
const { parseJsonlTranscript } = require("./lib/capture/transcript");
const { recordCaptureMetrics } = require("./lib/state/state");
const { buildCaptureTimestamp } = require("./lib/hook/capture-ops");
const {
  readStdin,
  toStringOrEmpty,
  firstNonEmptyString,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  resolveRuntimeContext,
  resolveInputCwd,
  resolveRuntimeConfig,
  buildSuccessResult,
  runStdinMain,
} = require("./lib/hook/hook-runtime");
const {
  loadCaptureState,
  saveCaptureState,
  setTranscriptTurnCount,
  getMmSuppressed,
  setMmSuppressed,
} = require("./lib/capture/capture-state");
const { UTF8_ENCODING } = require("./lib/shared/constants");
const { HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB } = require("./lib/hook/hook-events");

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

function buildRunPlan(rawStdin, runtime = {}) {
  const { env, fallbackCwd, homedir } = resolveRuntimeContext(runtime);
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
    iso: captureTimestamp.iso,
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

  const vaultPath = resolvedConfig.vaultPath;
  const subfolder = resolvedConfig.subfolder;
  const promptText = plan.promptEntry.text;

  const dailyEntry = buildDailyEntry(plan.promptEntry.entryName, promptText, plan.timestamp);
  appendToDaily(vaultPath, subfolder, plan.today, dailyEntry);
  recordCaptureMetrics(
    vaultPath,
    subfolder,
    HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
    plan.iso,
    promptText,
    promptText,
  );
}

function toCommandErrorResult(error) {
  return buildCommandErrorResult(error);
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
    const mmSuppressed = getMmSuppressed(captureState);

    if (isMmCommand(plan.promptEntry.text)) {
      const suppressedState = setMmSuppressed(captureState, true);
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, suppressedState);
      return buildSuccessResult();
    }

    if (mmSuppressed) {
      const unsuppressedState = setMmSuppressed(captureState, false);
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, unsuppressedState);
    }

    persistPromptSubmission(plan, resolvedConfig);
    return buildSuccessResult();
  } catch (error) {
    return toCommandErrorResult(error);
  }
}

const main = (runtime = {}) => runStdinMain(runtime, run);

module.exports = {
  resolveRuntimeConfig,
  firstNonEmptyString,
  readStdin,
  readGlobalConfigText,
  readDotEnvText,
  readGlobalDotEnvText,
  run,
  main,
};

if (require.main === module) {
  main();
}
