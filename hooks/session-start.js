#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseJsonInput } = require("./lib/config");
const { buildCommandErrorResult } = require("./lib/cli");
const {
  buildKnowledgeIndexPath,
  buildDailyFolderPath,
  buildHotCachePath,
  buildDailyFilePath,
  takeLastLines,
  buildAdditionalContext,
  truncateContext,
  localNow,
  localYesterday,
} = require("./lib/vault");
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
} = require("./lib/hook-runtime");
const {
  SESSION_START_RECENT_LOG_LINES,
  HOT_CACHE_CONTEXT_MAX_CHARS,
  INDEX_CONTEXT_MAX_CHARS,
} = require("./lib/constants");

function readFileOrEmpty(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
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
    return fsApi.readFileSync(path.join(folderPath, lastChunk), "utf-8");
  }

  if (fsApi.existsSync(flatPath)) {
    return fsApi.readFileSync(flatPath, "utf-8");
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
  const hotPath = buildHotCachePath(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const hotText = readFileOrEmpty(hotPath);

  if (hotText.trim() !== "") {
    return {
      primaryText: hotText,
      maxChars: HOT_CACHE_CONTEXT_MAX_CHARS,
      primarySectionHeading: "Hot Cache",
      primaryPlaceholderText: "(empty - no hot cache yet)",
    };
  }

  const indexPath = buildKnowledgeIndexPath(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const indexText = readFileOrEmpty(indexPath);

  return {
    primaryText: indexText,
    maxChars: INDEX_CONTEXT_MAX_CHARS,
    primarySectionHeading: "Knowledge Base Index",
    primaryPlaceholderText: "(empty - no articles compiled yet)",
  };
}

function buildSessionAdditionalContext(resolvedConfig) {
  const { primaryText, maxChars, primarySectionHeading, primaryPlaceholderText } =
    resolvePrimaryContext(resolvedConfig);
  const recentLogText = readRecentDailyLog(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  return truncateContext(
    buildAdditionalContext(
      primaryText,
      recentLogText,
      primarySectionHeading,
      primaryPlaceholderText,
    ),
    maxChars,
  );
}

function buildSessionStartStdout(additionalContext) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
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
    return buildCommandErrorResult(error);
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

/* c8 ignore next 3 */
if (require.main === module) {
  main();
}
