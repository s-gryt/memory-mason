#!/usr/bin/env node
/**
 * This module handles post tool use logic.
 */
"use strict";

const { parseJsonInput, detectPlatform } = require("./lib/config/config");
const { buildCommandErrorResult } = require("./lib/cli/cli");
const { CAPTURE_MODE_LITE, ENV_KEY_INVOKED_BY } = require("./lib/config/constants");
const {
  NOISY_TOOLS,
  EVENT_TYPE_EXPLORATION,
  EVENT_TYPE_META,
  EVENT_TYPE_NOISE,
  EVENT_TYPE_DECISION,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
  MAX_TAG_STRIP_COUNT,
} = require("./lib/filter/constants");
const {
  PLATFORM_CLAUDE_CODE,
  PLATFORM_COPILOT_VSCODE,
  PLATFORM_COPILOT_CLI,
  PLATFORM_CODEX,
} = require("./lib/config/platforms");
const { TRANSCRIPT_BLOCK_TYPE_TEXT } = require("./lib/capture/transcript-labels");
const { buildDailyEntry } = require("./lib/vault/vault");
const { appendToDaily } = require("./lib/vault/writer");
const { recordCaptureMetrics } = require("./lib/state/state");
const { loadCaptureState, getMmSuppressed } = require("./lib/capture/capture-state");
const { stripMemoryTags, countMemoryTags } = require("./lib/filter/tag-stripper");
const { classifyToolEvent } = require("./lib/filter/classifier");
const { detectSensitiveContent } = require("./lib/filter/sensitive-guard");
const { compressNarrativeText } = require("./lib/economics/compress");
const { HOOK_EVENT_POST_TOOL_USE_KEBAB } = require("./lib/hook/hook-events");
const { buildCaptureTimestamp } = require("./lib/hook/capture-ops");
const { stripVTControlCharacters } = require("node:util");
const hookRuntime = require("./lib/hook/hook-runtime");
const {
  readStdin,
  toStringOrEmpty,
  resolveRuntimeContext,
  resolveInputCwd,
  resolveRuntimeConfig,
  buildSuccessResult,
  runStdinMain,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
} = hookRuntime;

const EMPTY_STRING = "";
const NULL_VALUE = null;
const ZERO = 0;
const FIRST_INDEX = 0;

function toObjectRecord(value) {
  return value !== NULL_VALUE && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseToolArgs(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return toObjectRecord(parsed);
    } catch {
      return {};
    }
  }

  return toObjectRecord(value);
}

function firstStringFromArray(value) {
  if (!Array.isArray(value)) {
    return EMPTY_STRING;
  }

  return toStringOrEmpty(value[FIRST_INDEX]);
}

function firstNonEmptyString(candidates) {
  const found = candidates
    .map((candidate) => toStringOrEmpty(candidate))
    .find((candidate) => candidate !== EMPTY_STRING);

  return typeof found === "string" ? found : EMPTY_STRING;
}

function firstInteger(candidates) {
  const found = candidates.find((candidate) => Number.isInteger(candidate));
  return typeof found === "number" ? found : NULL_VALUE;
}

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
          block.type === TRANSCRIPT_BLOCK_TYPE_TEXT &&
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

  return EMPTY_STRING;
}

function extractClaudeOrCopilotVscodePayload(input) {
  const toolInput = toObjectRecord(input.tool_input);
  const toolResponse = toObjectRecord(input.tool_response);
  const filePath = firstNonEmptyString([
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
    firstStringFromArray(toolInput.filePaths),
    firstStringFromArray(toolInput.paths),
  ]);

  return {
    toolName: toStringOrEmpty(input.tool_name),
    resultText: serializeToolResponse(input.tool_response),
    filePath,
    exitCode: firstInteger([toolResponse.exitCode, input.exitCode]),
    commandText: toStringOrEmpty(toolInput.command),
  };
}

function extractCopilotCliPayload(input) {
  const toolResult = toObjectRecord(input.toolResult);
  const toolArgs = parseToolArgs(input.toolArgs);
  const textResultForLlm = toStringOrEmpty(toolResult.textResultForLlm);

  return {
    toolName: toStringOrEmpty(input.toolName),
    resultText: textResultForLlm,
    filePath: firstNonEmptyString([toolArgs.file_path, toolArgs.filePath, toolArgs.path]),
    exitCode: firstInteger([toolResult.exitCode, input.exitCode]),
    commandText: toStringOrEmpty(toolArgs.command),
  };
}

function extractCodexPayload(input) {
  const toolInput = toObjectRecord(input.tool_input);

  return {
    toolName: toStringOrEmpty(input.tool_name),
    resultText: toStringOrEmpty(input.tool_result),
    filePath: firstNonEmptyString([toolInput.file_path, toolInput.filePath, toolInput.path]),
    exitCode: firstInteger([input.exitCode]),
    commandText: toStringOrEmpty(toolInput.command),
  };
}

function extractToolPayload(platform, input) {
  const extractorByPlatform = {
    [PLATFORM_CLAUDE_CODE]: extractClaudeOrCopilotVscodePayload,
    [PLATFORM_COPILOT_VSCODE]: extractClaudeOrCopilotVscodePayload,
    [PLATFORM_COPILOT_CLI]: extractCopilotCliPayload,
    [PLATFORM_CODEX]: extractCodexPayload,
  };
  const extractor = extractorByPlatform[platform];

  if (typeof extractor === "function") {
    return extractor(input);
  }

  throw new Error(`unsupported platform: ${platform}`);
}

const shouldSkipToolPayload = (payload, captureMode) => {
  if (payload.toolName === "") {
    return true;
  }

  if (NOISY_TOOLS.has(payload.toolName)) {
    return true;
  }

  const classification = classifyToolEvent({
    toolName: payload.toolName,
    exitCode: payload.exitCode,
    output: payload.strippedResultText,
    filePath: payload.filePath,
    lineCount: payload.lineCount,
    captureMode,
    commandText: payload.commandText,
  });

  if (
    classification === EVENT_TYPE_EXPLORATION ||
    classification === EVENT_TYPE_META ||
    classification === EVENT_TYPE_NOISE
  ) {
    return true;
  }

  if (captureMode === CAPTURE_MODE_LITE) {
    return classification !== EVENT_TYPE_DECISION;
  }

  return false;
};

function buildRunPlan(rawStdin, runtime = {}) {
  const { env, fallbackCwd, homedir } = resolveRuntimeContext(runtime);
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
    iso: captureTimestamp.iso,
  };
}

function persistToolUsage(plan, resolvedConfig) {
  const vaultPath = resolvedConfig.vaultPath;
  const subfolder = resolvedConfig.subfolder;
  const dailyEntry = buildDailyEntry(
    plan.payload.toolName,
    plan.payload.resultText,
    plan.timestamp,
  );
  appendToDaily(vaultPath, subfolder, plan.today, dailyEntry);
  recordCaptureMetrics(
    vaultPath,
    subfolder,
    HOOK_EVENT_POST_TOOL_USE_KEBAB,
    plan.iso,
    plan.payload.rawResultText,
    plan.payload.resultText,
  );
}

function loadCaptureStateForConfig(resolvedConfig) {
  return loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
}

function enrichPayloadForCapture(payload) {
  const tagCount = countMemoryTags(payload.resultText);
  const strippedResultText = compressNarrativeText(
    stripVTControlCharacters(stripMemoryTags(payload.resultText)),
  );
  const lineCount =
    strippedResultText === EMPTY_STRING ? ZERO : strippedResultText.split(/\r?\n/).length;

  return {
    tagCount,
    strippedResultText,
    enrichedPayload: {
      ...payload,
      strippedResultText,
      lineCount,
    },
  };
}

function run(rawStdin, runtime = {}) {
  const { env } = resolveRuntimeContext(runtime);

  if (toStringOrEmpty(env[ENV_KEY_INVOKED_BY]) !== "") {
    return buildSuccessResult();
  }

  try {
    const plan = buildRunPlan(rawStdin, runtime);
    const resolvedConfig = resolveRuntimeConfig(plan.cwd, plan.homedir);
    const syncDisabled = resolvedConfig.sync === false;

    if (syncDisabled) {
      return buildSuccessResult();
    }

    const captureState = loadCaptureStateForConfig(resolvedConfig);
    const mmSuppressed = getMmSuppressed(captureState);

    if (mmSuppressed) {
      return buildSuccessResult();
    }

    const payloadCaptureData = enrichPayloadForCapture(plan.payload);

    if (shouldSkipToolPayload(payloadCaptureData.enrichedPayload, resolvedConfig.captureMode)) {
      return buildSuccessResult();
    }

    const sensitiveInput = [
      plan.payload.filePath,
      plan.payload.commandText,
      payloadCaptureData.strippedResultText,
    ]
      .filter((part) => part !== EMPTY_STRING)
      .join("\n");

    const sensitiveResult = detectSensitiveContent(sensitiveInput);

    if (sensitiveResult.isSensitive) {
      return {
        ...buildSuccessResult(),
        stderr: `${HOOK_WARNING_SENSITIVE_SKIP_PREFIX}: ${sensitiveResult.reasons.join(", ")}\n`,
      };
    }

    const tagWarning =
      payloadCaptureData.tagCount > MAX_TAG_STRIP_COUNT
        ? `${HOOK_WARNING_TAG_LIMIT_PREFIX}: ${payloadCaptureData.tagCount} tags found\n`
        : EMPTY_STRING;

    persistToolUsage(
      {
        ...plan,
        payload: {
          ...payloadCaptureData.enrichedPayload,
          rawResultText: plan.payload.resultText,
          resultText: payloadCaptureData.strippedResultText,
        },
      },
      resolvedConfig,
    );

    const result = buildSuccessResult();
    return tagWarning === EMPTY_STRING ? result : { ...result, stderr: tagWarning };
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

if (require.main === module) {
  main();
}
