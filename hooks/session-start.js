#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseJsonInput, resolveVaultConfig } = require("./lib/config");
const { buildCommandErrorResult, writeIfPresent } = require("./lib/cli");
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

function readStdin(fsApi = fs) {
  const fd = 0;

  function readChunks() {
    const chunk = Buffer.alloc(65536);
    const bytesRead = fsApi.readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead <= 0) {
      return [];
    }
    return [chunk.slice(0, bytesRead)].concat(readChunks());
  }

  return Buffer.concat(readChunks()).toString("utf-8");
}

function toStringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function readConfigText(cwd) {
  const configPath = path.join(cwd, "memory-mason.json");
  if (!fs.existsSync(configPath)) {
    return "";
  }
  return fs.readFileSync(configPath, "utf-8");
}

function readDotEnvText(cwd) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    return "";
  }
  return fs.readFileSync(envPath, "utf-8");
}

function readGlobalConfigText(homedir) {
  const globalConfigPath = path.join(homedir, ".memory-mason", "config.json");
  if (!fs.existsSync(globalConfigPath)) {
    return "";
  }
  return fs.readFileSync(globalConfigPath, "utf-8");
}

function readGlobalDotEnvText(homedir) {
  const globalEnvPath = path.join(homedir, ".memory-mason", ".env");
  if (!fs.existsSync(globalEnvPath)) {
    return "";
  }
  return fs.readFileSync(globalEnvPath, "utf-8");
}

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
    return takeLastLines(todayText, 30);
  }

  const yesterdayText = readDailyLogText(vaultPath, subfolder, yesterday, fsApi);
  if (yesterdayText !== "") {
    return takeLastLines(yesterdayText, 30);
  }

  return "";
}

function resolveRuntimeEnv(runtime) {
  return runtime.env !== null && typeof runtime.env === "object" ? runtime.env : process.env;
}

function resolveFallbackCwd(runtime) {
  return typeof runtime.cwd === "string" ? runtime.cwd : process.cwd();
}

function resolveRuntimeHomedir(runtime) {
  return typeof runtime.homedir === "string" ? runtime.homedir : os.homedir();
}

function resolveInputCwd(input, fallbackCwd) {
  const inputCwd = toStringOrEmpty(input.cwd);
  return inputCwd !== "" ? inputCwd : fallbackCwd;
}

function readConfigSources(cwd, homedir) {
  return {
    configText: readConfigText(cwd),
    dotEnvText: readDotEnvText(cwd),
    globalConfigText: readGlobalConfigText(homedir),
    globalDotEnvText: readGlobalDotEnvText(homedir),
  };
}

function resolveRuntimeConfig(cwd, env, homedir) {
  const configSources = readConfigSources(cwd, homedir);
  return resolveVaultConfig(
    cwd,
    toStringOrEmpty(env.MEMORY_MASON_VAULT_PATH),
    configSources.configText,
    homedir,
    {
      dotEnvText: configSources.dotEnvText,
      globalConfigText: configSources.globalConfigText,
      globalDotEnvText: configSources.globalDotEnvText,
    },
  );
}

function resolvePrimaryContext(resolvedConfig) {
  const hotPath = buildHotCachePath(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const hotText = readFileOrEmpty(hotPath);

  if (hotText.trim() !== "") {
    return {
      primaryText: hotText,
      maxChars: 5000,
      primarySectionHeading: "Hot Cache",
      primaryPlaceholderText: "(empty - no hot cache yet)",
    };
  }

  const indexPath = buildKnowledgeIndexPath(resolvedConfig.vaultPath, resolvedConfig.subfolder);
  const indexText = readFileOrEmpty(indexPath);

  return {
    primaryText: indexText,
    maxChars: 10000,
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
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);

  try {
    const input = parseJsonInput(rawStdin);
    const cwd = resolveInputCwd(input, fallbackCwd);
    const resolvedConfig = module.exports.resolveRuntimeConfig(cwd, env, homedir);

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
  /* c8 ignore start */
  const io = runtime.io !== null && typeof runtime.io === "object" ? runtime.io : {};
  const stdout = typeof io.stdout === "function" ? io.stdout : (text) => process.stdout.write(text);
  const stderr = typeof io.stderr === "function" ? io.stderr : (text) => process.stderr.write(text);
  const exit = typeof io.exit === "function" ? io.exit : (code) => process.exit(code);
  const fsApi = runtime.fs !== null && typeof runtime.fs === "object" ? runtime.fs : fs;
  /* c8 ignore stop */
  const result = run(readStdin(fsApi), runtime);
  /* c8 ignore start */
  writeIfPresent(result.stdout, stdout);
  writeIfPresent(result.stderr, stderr);
  exit(result.status);
  /* c8 ignore stop */
  return result;
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
