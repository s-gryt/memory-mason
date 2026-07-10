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
  EVENT_TYPE_ERROR,
  EVENT_TYPE_EXPLORATION,
  EVENT_TYPE_META,
  EVENT_TYPE_NOISE,
  EVENT_TYPE_DECISION,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
  MAX_TAG_STRIP_COUNT,
} = require("./lib/filter/constants");
const { COACHING_KIND_ERROR_REPEAT } = require("./lib/capture/constants");
const {
  PLATFORM_CLAUDE_CODE,
  PLATFORM_COPILOT_VSCODE,
  PLATFORM_COPILOT_CLI,
  PLATFORM_CODEX,
} = require("./lib/config/platforms");
const { TRANSCRIPT_BLOCK_TYPE_TEXT } = require("./lib/capture/transcript-labels");
const { buildDailyEntry, buildSessionContext } = require("./lib/vault/vault");
const { appendToDaily } = require("./lib/vault/writer");
const { isExchangeOpen } = require("./lib/capture/capture-state");
const { recordCaptureMetrics } = require("./lib/state/state");
const {
  loadCaptureState,
  saveCaptureState,
  getMmSuppressed,
  hashCoachingError,
  buildCoachingSnippet,
  recordCoachingHit,
  shouldEmitCoachingNag,
  markCoachingNagged,
} = require("./lib/capture/capture-state");
const { emitRepeatedPlanCoachingNag } = require("./lib/capture/coaching-emit");
const { stripMemoryTags, countMemoryTags } = require("./lib/filter/tag-stripper");
const { classifyToolEvent } = require("./lib/filter/classifier");
const { detectSensitiveContent } = require("./lib/filter/sensitive-guard");
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

const shouldSkipToolPayload = (
  payload,
  captureMode,
  classification = classifyEnrichedPayload(payload, captureMode),
) => {
  if (payload.toolName === "") {
    return true;
  }

  if (NOISY_TOOLS.has(payload.toolName)) {
    return true;
  }

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
  const cwd = resolveInputCwd(input, fallbackCwd);
  const sessionId = toStringOrEmpty(input.session_id) || toStringOrEmpty(input.sessionId);

  return {
    env,
    homedir,
    cwd,
    platform,
    sessionId,
    payload,
    today: captureTimestamp.today,
    timestamp: captureTimestamp.timestamp,
    iso: captureTimestamp.iso,
  };
}

function persistToolUsage(plan, resolvedConfig, captureState) {
  const vaultPath = resolvedConfig.vaultPath;
  const subfolder = resolvedConfig.subfolder;
  const session = buildSessionContext(plan.sessionId, plan.platform, plan.cwd);
  const exchangeOpen = plan.sessionId !== "" && isExchangeOpen(captureState, plan.sessionId);
  const dailyEntry = buildDailyEntry(
    plan.payload.toolName,
    plan.payload.resultText,
    plan.timestamp,
  );
  appendToDaily(vaultPath, subfolder, plan.today, dailyEntry, { session, exchangeOpen });
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

function classifyEnrichedPayload(payload, captureMode) {
  return classifyToolEvent({
    toolName: payload.toolName,
    exitCode: payload.exitCode,
    output: payload.strippedResultText,
    filePath: payload.filePath,
    lineCount: payload.lineCount,
    captureMode,
    commandText: payload.commandText,
  });
}

function tryHashCoachingError(text) {
  try {
    return hashCoachingError(text);
  } catch (_error) {
    return EMPTY_STRING;
  }
}

function applyErrorCoachingToState(
  captureState,
  plan,
  resolvedConfig,
  enrichedPayload,
  classification = classifyEnrichedPayload(enrichedPayload, resolvedConfig.captureMode),
) {
  if (plan.sessionId === EMPTY_STRING) {
    return captureState;
  }

  if (classification !== EVENT_TYPE_ERROR) {
    return captureState;
  }

  const hash = tryHashCoachingError(enrichedPayload.strippedResultText);
  if (hash === EMPTY_STRING) {
    return captureState;
  }

  const snippet = buildCoachingSnippet(
    COACHING_KIND_ERROR_REPEAT,
    enrichedPayload.strippedResultText,
  );
  const updatedState = recordCoachingHit(
    captureState,
    hash,
    plan.sessionId,
    plan.iso,
    COACHING_KIND_ERROR_REPEAT,
    snippet,
  );

  return emitRepeatedPlanCoachingNag({
    state: updatedState,
    hash,
    plan,
    resolvedConfig,
    kind: COACHING_KIND_ERROR_REPEAT,
    shouldEmitNag: shouldEmitCoachingNag,
    markNagged: markCoachingNagged,
  });
}

function enrichPayloadForCapture(payload) {
  const tagCount = countMemoryTags(payload.resultText);
  const baseText = stripVTControlCharacters(stripMemoryTags(payload.resultText));
  const strippedResultText = baseText;
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
    const classification = classifyEnrichedPayload(
      payloadCaptureData.enrichedPayload,
      resolvedConfig.captureMode,
    );

    if (
      shouldSkipToolPayload(
        payloadCaptureData.enrichedPayload,
        resolvedConfig.captureMode,
        classification,
      )
    ) {
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

    const coachedState = applyErrorCoachingToState(
      captureState,
      plan,
      resolvedConfig,
      payloadCaptureData.enrichedPayload,
      classification,
    );
    if (coachedState !== captureState) {
      saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, coachedState);
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
      coachedState,
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
  tryHashCoachingError,
  applyErrorCoachingToState,
  run,
  main,
};

if (require.main === module) {
  main();
}
