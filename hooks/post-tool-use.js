#!/usr/bin/env node
"use strict";

const { parseJsonInput, detectPlatform } = require("./lib/config");
const { buildCommandErrorResult } = require("./lib/cli");
const { CAPTURE_MODE_LITE, NOISY_TOOLS, USER_INPUT_TOOLS } = require("./lib/constants");
const { buildDailyEntry, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
const { loadCaptureState, getMmSuppressed } = require("./lib/capture-state");
const {
  readStdin,
  toStringOrEmpty,
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

function serializeToolResponse(toolResponse) {
  if (typeof toolResponse === "string") {
    return toolResponse;
  }

  if (Array.isArray(toolResponse)) {
    const textBlocks = toolResponse
      .filter(
        (block) =>
          block !== null &&
          typeof block === "object" &&
          !Array.isArray(block) &&
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim() !== "",
      )
      .map((block) => block.text.trim());

    if (textBlocks.length > 0) {
      return textBlocks.join("\n");
    }

    return JSON.stringify(toolResponse, null, 2);
  }

  if (toolResponse !== null && typeof toolResponse === "object") {
    return JSON.stringify(toolResponse, null, 2);
  }

  return "";
}

function extractClaudeOrCopilotVscodePayload(input) {
  return {
    toolName: toStringOrEmpty(input.tool_name),
    resultText: serializeToolResponse(input.tool_response),
  };
}

function extractCopilotCliPayload(input) {
  const toolResult =
    input.toolResult !== null &&
    typeof input.toolResult === "object" &&
    !Array.isArray(input.toolResult)
      ? input.toolResult
      : {};
  const textResultForLlm =
    typeof toolResult.textResultForLlm === "string" ? toolResult.textResultForLlm : "";

  return {
    toolName: toStringOrEmpty(input.toolName),
    resultText: textResultForLlm,
  };
}

function extractCodexPayload(input) {
  return {
    toolName: toStringOrEmpty(input.tool_name),
    resultText: toStringOrEmpty(input.tool_result),
  };
}

function extractToolPayload(platform, input) {
  const extractorByPlatform = {
    "claude-code": extractClaudeOrCopilotVscodePayload,
    "copilot-vscode": extractClaudeOrCopilotVscodePayload,
    "copilot-cli": extractCopilotCliPayload,
    codex: extractCodexPayload,
  };
  const extractor = extractorByPlatform[platform];

  if (typeof extractor === "function") {
    return extractor(input);
  }

  throw new Error(`unsupported platform: ${platform}`);
}

function buildCaptureTimestamp() {
  const now = localNow();
  return {
    today: now.date,
    timestamp: now.time,
  };
}

const shouldSkipToolPayload = (payload, captureMode) => {
  if (payload.toolName === "") {
    return true;
  }

  if (captureMode === CAPTURE_MODE_LITE) {
    return !USER_INPUT_TOOLS.has(payload.toolName);
  }

  return NOISY_TOOLS.has(payload.toolName);
};

function buildRunPlan(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);
  const input = parseJsonInput(rawStdin);
  const platform = detectPlatform(input);
  const payload = extractToolPayload(platform, input);
  const captureTimestamp = buildCaptureTimestamp();

  return {
    env,
    homedir,
    cwd: resolveInputCwd(input, fallbackCwd),
    payload,
    today: captureTimestamp.today,
    timestamp: captureTimestamp.timestamp,
  };
}

function persistToolUsage(plan, resolvedConfig) {
  const dailyEntry = buildDailyEntry(
    plan.payload.toolName,
    plan.payload.resultText,
    plan.timestamp,
  );
  appendToDaily(resolvedConfig.vaultPath, resolvedConfig.subfolder, plan.today, dailyEntry);
}

function run(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);

  if (toStringOrEmpty(env.MEMORY_MASON_INVOKED_BY) !== "") {
    return buildSuccessResult();
  }

  try {
    const plan = buildRunPlan(rawStdin, runtime);
    const resolvedConfig = resolveRuntimeConfig(plan.cwd, plan.homedir);

    if (resolvedConfig.sync === false) {
      return buildSuccessResult();
    }

    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);

    if (getMmSuppressed(captureState)) {
      return buildSuccessResult();
    }

    if (shouldSkipToolPayload(plan.payload, resolvedConfig.captureMode)) {
      return buildSuccessResult();
    }

    persistToolUsage(plan, resolvedConfig);
    return buildSuccessResult();
  } catch (error) {
    return buildCommandErrorResult(error);
  }
}

const main = (runtime = {}) => runStdinMain(runtime, run);

module.exports = {
  readStdin,
  serializeToolResponse,
  extractToolPayload,
  shouldSkipToolPayload,
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
