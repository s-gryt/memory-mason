#!/usr/bin/env node
// Handles the user prompt submit hook entrypoint.
"use strict";

const fs = require("node:fs");
const config = require("./lib/config/config");
const cli = require("./lib/cli/cli");
const vault = require("./lib/vault/vault");
const { appendToDaily } = require("./lib/vault/writer");
const { extractPromptEntry, isMmCommand } = require("./lib/prompt/prompt");
const { parseJsonlTranscript } = require("./lib/capture/transcript");
const { recordCaptureMetrics } = require("./lib/state/state");
const captureOps = require("./lib/hook/capture-ops");
const { detectSensitiveContent } = require("./lib/filter/sensitive-guard");
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
  hashCoachingPrompt,
  buildCoachingSnippet,
  recordCoachingHit,
  shouldEmitCoachingNag,
  markCoachingNagged,
  isExchangeOpen,
  openExchange,
  closeExchange,
} = require("./lib/capture/capture-state");
const { emitRepeatedPlanCoachingNag } = require("./lib/capture/coaching-emit");
const { COACHING_KIND_PROMPT_REPEAT } = require("./lib/capture/constants");
const { UTF8_ENCODING } = require("./lib/shared/constants");
const { HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB } = require("./lib/hook/hook-events");
const EMPTY_STRING = "";

function resolvePromptPayload(rawStdin) {
  const input = config.parseJsonInput(rawStdin);
  const platform = config.detectPlatform(input);
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
  const captureTimestamp = captureOps.buildCaptureTimestamp();
  const platform = config.detectPlatform(payload.input);
  return {
    env,
    homedir,
    cwd,
    input: payload.input,
    platform,
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

function updateTranscriptState(captureState, transcriptPath, sessionId) {
  const transcriptContent = fs.readFileSync(transcriptPath, UTF8_ENCODING);
  const turns = parseJsonlTranscript(transcriptContent);
  return setTranscriptTurnCount(captureState, sessionId, turns.length);
}

function buildSessionContextForPlan(plan) {
  return vault.buildSessionContext(plan.sessionId, plan.platform, plan.cwd);
}

function persistPromptSubmission(plan, resolvedConfig, captureState) {
  const latestState = shouldUpdateTranscriptState(plan.transcriptPath, plan.sessionId)
    ? updateTranscriptState(captureState, plan.transcriptPath, plan.sessionId)
    : captureState;

  const vaultPath = resolvedConfig.vaultPath;
  const subfolder = resolvedConfig.subfolder;
  const promptText = plan.promptEntry.text;
  const sensitivity = detectSensitiveContent(promptText);
  const storedPromptText = sensitivity.isSensitive
    ? `prompt withheld: ${sensitivity.reasons.join(", ")}`
    : promptText;
  const session = buildSessionContextForPlan(plan);

  const exchangeWasOpen = plan.sessionId !== "" && isExchangeOpen(latestState, plan.sessionId);
  let nextState = exchangeWasOpen ? closeExchange(latestState, plan.sessionId) : latestState;

  const dailyEntry = vault.buildDailyEntry(
    plan.promptEntry.entryName,
    storedPromptText,
    plan.timestamp,
  );
  appendToDaily(vaultPath, subfolder, plan.today, dailyEntry, { session });

  if (plan.sessionId !== "") {
    nextState = openExchange(nextState, plan.sessionId, plan.iso);
  }

  recordCaptureMetrics(
    vaultPath,
    subfolder,
    HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
    plan.iso,
    promptText,
    storedPromptText,
  );

  return nextState;
}

function tryHashCoachingPrompt(text) {
  try {
    return hashCoachingPrompt(text);
  } catch (_error) {
    return "";
  }
}

function applyCoachingToState(state, plan, resolvedConfig) {
  if (plan.sessionId === "") {
    return state;
  }
  const hash = tryHashCoachingPrompt(plan.promptEntry.text);
  if (hash === "") {
    return state;
  }

  const sensitivity = detectSensitiveContent(plan.promptEntry.text);
  const snippet = sensitivity.isSensitive
    ? EMPTY_STRING
    : buildCoachingSnippet(COACHING_KIND_PROMPT_REPEAT, plan.promptEntry.text);
  const updatedState = recordCoachingHit(
    state,
    hash,
    plan.sessionId,
    plan.iso,
    COACHING_KIND_PROMPT_REPEAT,
    snippet,
  );

  return emitRepeatedPlanCoachingNag({
    state: updatedState,
    hash,
    plan,
    resolvedConfig,
    kind: COACHING_KIND_PROMPT_REPEAT,
    shouldEmitNag: shouldEmitCoachingNag,
    markNagged: markCoachingNagged,
  });
}

function toCommandErrorResult(error) {
  return cli.buildCommandErrorResult(error);
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

    const unsuppressedState = getMmSuppressed(captureState)
      ? setMmSuppressed(captureState, false)
      : captureState;
    const coachedState = applyCoachingToState(unsuppressedState, plan, resolvedConfig);
    const stampedState =
      plan.cwd !== "" ? { ...coachedState, lastProjectPath: plan.cwd } : coachedState;
    const finalState = persistPromptSubmission(plan, resolvedConfig, stampedState);
    saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, finalState);
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
