#!/usr/bin/env node
/**
 * This module handles session start logic.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseJsonInput } = require("./lib/config/config");
const { buildCommandErrorResult } = require("./lib/cli/cli");
const {
  buildRootIndexPath,
  buildDailyFolderPath,
  buildSessionContextPath,
  buildDailyFilePath,
  takeLastLines,
  buildAdditionalContext,
  truncateContext,
  localNow,
  localYesterday,
} = require("./lib/vault/vault");
const {
  readStdin,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  resolveFallbackCwd,
  resolveRuntimeHomedir,
  resolveInputCwd,
  resolveRuntimeConfig,
  runStdinMain,
} = require("./lib/hook/hook-runtime");
const {
  SESSION_START_RECENT_LOG_LINES,
  HOT_CACHE_CONTEXT_MAX_CHARS,
  INDEX_CONTEXT_MAX_CHARS,
} = require("./lib/vault/constants");
const { UTF8_ENCODING } = require("./lib/shared/constants");
const {
  KNOWLEDGE_BASE_INDEX_HEADING,
  SESSION_CONTEXT_HEADING,
  PLACEHOLDER_NO_ARTICLES,
  PLACEHOLDER_NO_SESSION_CONTEXT,
} = require("./lib/vault/markdown-labels");
const { HOOK_ENTRY_SESSION_START } = require("./lib/hook/hook-events");
const { loadCaptureState } = require("./lib/capture/capture-state");
const {
  selectTopCoachingInsights,
  formatCoachingAdditionalContext,
} = require("./lib/coaching/insights");

const COACHING_INSIGHT_LIMIT = 3;

function readFileOrEmpty(filePath) {
  try {
    return fs.readFileSync(filePath, UTF8_ENCODING);
  } catch (_error) {
    return "";
  }
}

function assertNonEmptyStringValue(name, value) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function readDailyLogText(vaultPath, subfolder, dateIso, fsApi = fs) {
  const safeVaultPath = assertNonEmptyStringValue("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyStringValue("subfolder", subfolder);
  const safeDateIso = assertNonEmptyStringValue("dateIso", dateIso);

  const folderPath = buildDailyFolderPath(safeVaultPath, safeSubfolder, safeDateIso);
  const flatPath = buildDailyFilePath(safeVaultPath, safeSubfolder, safeDateIso);

  if (fsApi.existsSync(folderPath) && fsApi.statSync(folderPath).isDirectory()) {
    const entries = fsApi.readdirSync(folderPath);
    const chunkFiles = entries.filter((fileName) => /^\d{3}\.md$/.test(fileName)).sort();

    if (chunkFiles.length === 0) {
      return "";
    }

    const lastChunk = chunkFiles[chunkFiles.length - 1];
    return fsApi.readFileSync(path.join(folderPath, lastChunk), UTF8_ENCODING);
  }

  if (fsApi.existsSync(flatPath)) {
    return fsApi.readFileSync(flatPath, UTF8_ENCODING);
  }

  return "";
}

function readRecentDailyLog(vaultPath, subfolder, fsApi = fs) {
  const today = localNow().date;
  const yesterday = localYesterday();

  const todayText = readDailyLogText(vaultPath, subfolder, today, fsApi);
  if (todayText !== "") {
    return takeLastLines(todayText, SESSION_START_RECENT_LOG_LINES);
  }

  const yesterdayText = readDailyLogText(vaultPath, subfolder, yesterday, fsApi);
  if (yesterdayText !== "") {
    return takeLastLines(yesterdayText, SESSION_START_RECENT_LOG_LINES);
  }

  return "";
}

function resolvePrimaryContext(resolvedConfig) {
  const sessionContextPath = buildSessionContextPath(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
  );
  const sessionContextText = readFileOrEmpty(sessionContextPath);

  if (sessionContextText.trim() !== "") {
    return {
      primaryText: sessionContextText,
      maxChars: HOT_CACHE_CONTEXT_MAX_CHARS,
      primarySectionHeading: SESSION_CONTEXT_HEADING,
      primaryPlaceholderText: PLACEHOLDER_NO_SESSION_CONTEXT,
    };
  }

  const rootIndexPath = buildRootIndexPath(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const indexText = readFileOrEmpty(rootIndexPath);

  return {
    primaryText: indexText,
    maxChars: INDEX_CONTEXT_MAX_CHARS,
    primarySectionHeading: KNOWLEDGE_BASE_INDEX_HEADING,
    primaryPlaceholderText: PLACEHOLDER_NO_ARTICLES,
  };
}

function buildCoachingAdditionalText(resolvedConfig) {
  try {
    const state = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
    const insights = selectTopCoachingInsights(state, COACHING_INSIGHT_LIMIT);
    return formatCoachingAdditionalContext(insights);
  } catch (_error) {
    return "";
  }
}

function buildSessionAdditionalContext(resolvedConfig) {
  const { primaryText, maxChars, primarySectionHeading, primaryPlaceholderText } =
    resolvePrimaryContext(resolvedConfig);
  const recentLogText = readRecentDailyLog(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const baseContext = truncateContext(
    buildAdditionalContext(
      primaryText,
      recentLogText,
      primarySectionHeading,
      primaryPlaceholderText,
    ),
    maxChars,
  );

  const coachingText = buildCoachingAdditionalText(resolvedConfig);
  if (coachingText === "") {
    return baseContext;
  }
  return `${baseContext}\n\n${coachingText}`;
}

function buildSessionStartStdout(additionalContext) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: HOOK_ENTRY_SESSION_START,
      additionalContext,
    },
  })}\n`;
}

function buildSuccessResult(additionalContext) {
  return {
    status: 0,
    stdout: buildSessionStartStdout(additionalContext),
    stderr: "",
  };
}

function run(rawStdin, runtime = {}) {
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);

  try {
    const input = parseJsonInput(rawStdin);
    const cwd = resolveInputCwd(input, fallbackCwd);
    const resolvedConfig = module.exports.resolveRuntimeConfig(cwd, homedir);

    if (resolvedConfig.sync === false) {
      return buildSuccessResult("");
    }

    const additionalContext = buildSessionAdditionalContext(resolvedConfig);
    return buildSuccessResult(additionalContext);
  } catch (error) {
    const failure = buildCommandErrorResult(error);
    return failure;
  }
}

function main(runtime = {}) {
  return runStdinMain(runtime, run);
}

module.exports = {
  readStdin,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  readDailyLogText,
  readRecentDailyLog,
  resolveRuntimeConfig,
  run,
  main,
};

if (require.main === module) {
  main();
}
