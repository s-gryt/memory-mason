#!/usr/bin/env node
"use strict";

const { parseJsonInput, detectPlatform } = require("./lib/config");
const { buildCommandErrorResult } = require("./lib/cli");
const {
  CAPTURE_MODE_LITE,
  NOISY_TOOLS,
  EVENT_TYPE_EXPLORATION,
  EVENT_TYPE_META,
  EVENT_TYPE_NOISE,
  EVENT_TYPE_ERROR,
  EVENT_TYPE_TEST_RESULT,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
  MAX_TAG_STRIP_COUNT,
} = require("./lib/constants");
const {
  PLATFORM_CLAUDE_CODE,
  PLATFORM_COPILOT_VSCODE,
  PLATFORM_COPILOT_CLI,
  PLATFORM_CODEX,
} = require("./lib/platforms");
const { TRANSCRIPT_BLOCK_TYPE_TEXT } = require("./lib/transcript-labels");
const { ENV_KEY_INVOKED_BY } = require("./lib/config-keys");
const { buildDailyEntry, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
const { recordCaptureMetrics } = require("./lib/state");
const { loadCaptureState, getMmSuppressed } = require("./lib/capture-state");
const { stripMemoryTags, countMemoryTags } = require("./lib/tag-stripper");
const { classifyToolEvent } = require("./lib/classifier");
const { detectSensitiveContent } = require("./lib/sensitive-guard");
const { compressNarrativeText } = require("./lib/compress");
const { HOOK_EVENT_POST_TOOL_USE_KEBAB } = require("./lib/hook-events");
const { stripVTControlCharacters } = require("node:util");
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

const EMPTY_STRING = "";
const NULL_VALUE = null;
const ZERO = 0;
const FIRST_INDEX = 0;

/**
 * Convert unknown input into a plain object record.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function toObjectRecord(value) {
  return value !== NULL_VALUE && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Parse tool arguments payload from JSON string or object.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
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

/**
 * Return the first string value from an array-like candidate.
 *
 * @param {unknown} value
 * @returns {string}
 */
function firstStringFromArray(value) {
  if (!Array.isArray(value)) {
    return EMPTY_STRING;
  }

  return toStringOrEmpty(value[FIRST_INDEX]);
}

/**
 * Return the first non-empty string from ordered candidates.
 *
 * @param {unknown[]} candidates
 * @returns {string}
 */
function firstNonEmptyString(candidates) {
  const found = candidates
    .map((candidate) => toStringOrEmpty(candidate))
    .find((candidate) => candidate !== EMPTY_STRING);

  return typeof found === "string" ? found : EMPTY_STRING;
}

/**
 * Return the first integer from ordered candidates.
 *
 * @param {unknown[]} candidates
 * @returns {number | null}
 */
function firstInteger(candidates) {
  const found = candidates.find((candidate) => Number.isInteger(candidate));
  return typeof found === "number" ? found : NULL_VALUE;
}

/**
 * Serialize tool response payload content into capture-safe text.
 *
 * @param {unknown} toolResponse
 * @returns {string}
 */
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

/**
 * Extract tool payload fields from Claude Code or Copilot VS Code input shape.
 *
 * @param {Record<string, unknown>} input
 * @returns {{toolName: string, resultText: string, filePath: string, exitCode: number | null, commandText: string}}
 */
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

/**
 * Extract tool payload fields from Copilot CLI input shape.
 *
 * @param {Record<string, unknown>} input
 * @returns {{toolName: string, resultText: string, filePath: string, exitCode: number | null, commandText: string}}
 */
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

/**
 * Extract tool payload fields from Codex input shape.
 *
 * @param {Record<string, unknown>} input
 * @returns {{toolName: string, resultText: string, filePath: string, exitCode: number | null, commandText: string}}
 */
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

/**
 * Extract normalized tool payload by detected platform.
 *
 * @param {string} platform
 * @param {Record<string, unknown>} input
 * @returns {{toolName: string, resultText: string, filePath: string, exitCode: number | null, commandText: string}}
 */
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

function buildCaptureTimestamp() {
  const now = localNow();
  return {
    today: now.date,
    timestamp: now.time,
    iso: `${now.date}T${now.time}`,
  };
}

/**
 * Decide whether a normalized payload should be skipped for capture.
 *
 * @param {{toolName: string, exitCode?: number | null, strippedResultText?: string, filePath?: string, lineCount?: number, commandText?: string}} payload
 * @param {string} captureMode
 * @returns {boolean}
 */
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
    return classification !== EVENT_TYPE_ERROR && classification !== EVENT_TYPE_TEST_RESULT;
  }

  return false;
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
    iso: captureTimestamp.iso,
  };
}

function persistToolUsage(plan, resolvedConfig) {
  const dailyEntry = buildDailyEntry(
    plan.payload.toolName,
    plan.payload.resultText,
    plan.timestamp,
  );
  appendToDaily(resolvedConfig.vaultPath, resolvedConfig.subfolder, plan.today, dailyEntry);
  recordCaptureMetrics(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    HOOK_EVENT_POST_TOOL_USE_KEBAB,
    plan.iso,
    plan.payload.rawResultText,
    plan.payload.resultText,
  );
}

/**
 * Run post-tool-use capture flow for a raw stdin payload.
 *
 * @param {string} rawStdin
 * @param {Record<string, unknown>} [runtime]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function run(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);

  if (toStringOrEmpty(env[ENV_KEY_INVOKED_BY]) !== "") {
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

    const tagCount = countMemoryTags(plan.payload.resultText);
    const strippedResultText = compressNarrativeText(
      stripVTControlCharacters(stripMemoryTags(plan.payload.resultText)),
    );
    const lineCount =
      strippedResultText === EMPTY_STRING ? ZERO : strippedResultText.split(/\r?\n/).length;
    const enrichedPayload = {
      ...plan.payload,
      strippedResultText,
      lineCount,
    };

    if (shouldSkipToolPayload(enrichedPayload, resolvedConfig.captureMode)) {
      return buildSuccessResult();
    }

    const sensitiveInput = [plan.payload.filePath, plan.payload.commandText, strippedResultText]
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
      tagCount > MAX_TAG_STRIP_COUNT
        ? `${HOOK_WARNING_TAG_LIMIT_PREFIX}: ${tagCount} tags found\n`
        : EMPTY_STRING;

    persistToolUsage(
      {
        ...plan,
        payload: {
          ...enrichedPayload,
          rawResultText: plan.payload.resultText,
          resultText: strippedResultText,
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

/**
 * Execute stdin-driven main entrypoint.
 *
 * @param {Record<string, unknown>} [runtime]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
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
