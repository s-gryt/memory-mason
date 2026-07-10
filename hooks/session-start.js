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

function isExistingDirectory(folderPath, fsApi) {
  try {
    return fsApi.existsSync(folderPath) && fsApi.statSync(folderPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function pickMostRecentChunkFile(folderPath, chunkFiles, fsApi) {
  const sortedByName = [...chunkFiles].sort();
  const withMtime = sortedByName.map((fileName) => {
    try {
      const stats = fsApi.statSync(path.join(folderPath, fileName));
      const mtimeMs = typeof stats.mtimeMs === "number" ? stats.mtimeMs : NaN;
      return { fileName, mtimeMs };
    } catch (_error) {
      return { fileName, mtimeMs: NaN };
    }
  });

  const validEntries = withMtime.filter((entry) => !Number.isNaN(entry.mtimeMs));
  if (validEntries.length === 0) {
    return sortedByName[sortedByName.length - 1];
  }

  return validEntries.reduce((latest, entry) => (entry.mtimeMs > latest.mtimeMs ? entry : latest))
    .fileName;
}

function readDailyLogText(vaultPath, subfolder, dateIso, fsApi = fs) {
  const safeVaultPath = assertNonEmptyStringValue("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyStringValue("subfolder", subfolder);
  const safeDateIso = assertNonEmptyStringValue("dateIso", dateIso);

  const folderPath = buildDailyFolderPath(safeVaultPath, safeSubfolder, safeDateIso);
  const flatPath = buildDailyFilePath(safeVaultPath, safeSubfolder, safeDateIso);

  if (isExistingDirectory(folderPath, fsApi)) {
    const entries = fsApi.readdirSync(folderPath);
    const chunkFiles = entries.filter(
      (fileName) => /^\d{3}\.md$/.test(fileName) || /^\d{6}-[a-z0-9]+-\d{3}\.md$/.test(fileName),
    );

    if (chunkFiles.length === 0) {
      return "";
    }

    const lastChunk = pickMostRecentChunkFile(folderPath, chunkFiles, fsApi);
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

function loadSessionStartState(resolvedConfig) {
  try {
    return loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  } catch (_error) {
    return null;
  }
}

function buildCoachingAdditionalText(state) {
  if (state === null) {
    return "";
  }
  try {
    const insights = selectTopCoachingInsights(state, COACHING_INSIGHT_LIMIT);
    return formatCoachingAdditionalContext(insights);
  } catch (_error) {
    return "";
  }
}

function buildSharedStreamWarning(state, cwd) {
  if (typeof cwd !== "string" || cwd === "") {
    return "";
  }
  if (state === null) {
    return "";
  }
  const lastProjectPath = typeof state.lastProjectPath === "string" ? state.lastProjectPath : "";
  if (lastProjectPath === "" || lastProjectPath === cwd) {
    return "";
  }
  return `> [!warning] Memory Mason: this subfolder was last written by another project (${lastProjectPath}). Multiple projects share one capture stream; set a per-project subfolder (MEMORY_MASON_SUBFOLDER) to isolate them.`;
}

function buildSessionAdditionalContext(resolvedConfig, cwd) {
  const { primaryText, maxChars, primarySectionHeading, primaryPlaceholderText } =
    resolvePrimaryContext(resolvedConfig);
  const recentLogText = readRecentDailyLog(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const sessionState = loadSessionStartState(resolvedConfig);
  const baseContext = buildAdditionalContext(
    primaryText,
    recentLogText,
    primarySectionHeading,
    primaryPlaceholderText,
  );

  const additionalSections = [
    buildCoachingAdditionalText(sessionState),
    buildSharedStreamWarning(sessionState, cwd),
  ].filter((section) => section !== "");

  if (additionalSections.length === 0) {
    return truncateContext(baseContext, maxChars);
  }

  return [...additionalSections, truncateContext(baseContext, maxChars)].join("\n\n");
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

    const additionalContext = buildSessionAdditionalContext(resolvedConfig, cwd);
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
  buildCoachingAdditionalText,
  resolveRuntimeConfig,
  run,
  main,
};

if (require.main === module) {
  main();
}
