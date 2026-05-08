/**
 * This module handles config logic.
 */
"use strict";

const {
  CAPTURE_MODE_LITE,
  CAPTURE_MODE_FULL,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_SUBFOLDER,
  ENV_KEY_VAULT_PATH,
  ENV_KEY_SUBFOLDER,
  ENV_KEY_SYNC,
  ENV_KEY_CAPTURE_MODE,
} = require("./constants");
const {
  PLATFORM_CLAUDE_CODE,
  PLATFORM_COPILOT_VSCODE,
  PLATFORM_COPILOT_CLI,
  PLATFORM_CODEX,
} = require("./platforms");
const { assertNonEmptyString } = require("../shared/assert");

const JSON_ERROR_PREVIEW_CHARS = 200;

const parseJsonInput = (rawStdin) => {
  assertNonEmptyString("stdin", rawStdin);

  try {
    const parsed = JSON.parse(rawStdin);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`invalid JSON in stdin: ${rawStdin.slice(0, JSON_ERROR_PREVIEW_CHARS)}`);
    }
    return parsed;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  try {
    const escapedStdin = rawStdin.replace(/(?<!\\)\\(?!["\\])/g, "\\\\");
    const parsedEscaped = JSON.parse(escapedStdin);
    if (
      parsedEscaped === null ||
      typeof parsedEscaped !== "object" ||
      Array.isArray(parsedEscaped)
    ) {
      throw new Error(`invalid JSON in stdin: ${rawStdin.slice(0, JSON_ERROR_PREVIEW_CHARS)}`);
    }
    return parsedEscaped;
  } catch (_error) {
    throw new Error(`invalid JSON in stdin: ${rawStdin.slice(0, JSON_ERROR_PREVIEW_CHARS)}`);
  }
};

const expandHomePath = (inputPath, homedir) => {
  const safeInputPath = assertNonEmptyString("inputPath", inputPath);
  const safeHomedir = assertNonEmptyString("homedir", homedir);
  if (/^~(?=$|[\\/])/.test(safeInputPath)) {
    return safeInputPath.replace(/^~(?=$|[\\/])/, safeHomedir);
  }
  return safeInputPath;
};

const parseMemoryMasonConfig = (rawText) => {
  assertNonEmptyString("rawText", rawText);

  const parsed = (() => {
    try {
      return JSON.parse(rawText);
    } catch (_error) {
      throw new Error("invalid memory-mason config JSON");
    }
  })();

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("memory-mason config must be an object");
  }

  const vaultPath = assertNonEmptyString("vaultPath", parsed.vaultPath);
  const subfolder = assertNonEmptyString("subfolder", parsed.subfolder);
  const sync = parseSyncFieldFromConfigObject(parsed);
  return typeof sync === "boolean" ? { vaultPath, subfolder, sync } : { vaultPath, subfolder };
};

const describeValueType = (value) => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
};

const parseSyncFieldFromConfigObject = (parsedConfig) => {
  if (!Object.hasOwn(parsedConfig, "sync")) {
    return null;
  }

  if (typeof parsedConfig.sync === "boolean") {
    return parsedConfig.sync;
  }

  throw new Error(`config sync must be a boolean, got: ${describeValueType(parsedConfig.sync)}`);
};

const VALID_CAPTURE_MODES = Object.freeze([CAPTURE_MODE_LITE, CAPTURE_MODE_FULL]);

const parseCaptureModeFromConfigObject = (parsedConfig) => {
  if (!Object.hasOwn(parsedConfig, "captureMode")) {
    return null;
  }

  const value = parsedConfig.captureMode;
  if (VALID_CAPTURE_MODES.includes(value)) {
    return value;
  }

  const invalidValueDescription = typeof value === "string" ? value : describeValueType(value);
  throw new Error(
    `config captureMode must be '${CAPTURE_MODE_LITE}' or '${CAPTURE_MODE_FULL}', got: ${invalidValueDescription}`,
  );
};

const parseConfigObjectOrNull = (configText) => {
  if (configText === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(configText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
};

const parseConfigCaptureModeOrNull = (configText) => {
  const parsedConfig = parseConfigObjectOrNull(configText);
  if (parsedConfig === null) {
    return null;
  }

  return parseCaptureModeFromConfigObject(parsedConfig);
};

const parseEnvSyncOrNull = (envSyncValue) => {
  if (typeof envSyncValue !== "string" || envSyncValue === "") {
    return null;
  }

  if (envSyncValue === "false") {
    return false;
  }

  if (envSyncValue === "true") {
    return true;
  }

  throw new Error(`${ENV_KEY_SYNC} must be 'true' or 'false', got: ${envSyncValue}`);
};

const parseEnvCaptureModeOrNull = (envValue) => {
  if (typeof envValue !== "string" || envValue === "") {
    return null;
  }

  if (VALID_CAPTURE_MODES.includes(envValue)) {
    return envValue;
  }

  throw new Error(
    `${ENV_KEY_CAPTURE_MODE} must be '${CAPTURE_MODE_LITE}' or '${CAPTURE_MODE_FULL}', got: ${envValue}`,
  );
};

const stripDotEnvComment = (valueText) => {
  const trimmedValue = valueText.trim();
  const isSingleQuoted = trimmedValue.startsWith("'");
  const isDoubleQuoted = trimmedValue.startsWith('"');

  if (!isSingleQuoted && !isDoubleQuoted) {
    return trimmedValue.split("#")[0].trim();
  }

  const quote = isSingleQuoted ? "'" : '"';
  const closingQuoteIndex = trimmedValue.indexOf(quote, 1);

  if (closingQuoteIndex === -1) {
    return trimmedValue;
  }

  return trimmedValue.slice(0, closingQuoteIndex + 1);
};

const stripSurroundingQuotes = (valueText) => {
  const trimmedValue = valueText.trim();
  const firstCharacter = trimmedValue[0];
  const lastCharacter = trimmedValue[trimmedValue.length - 1];
  const hasSurroundingQuotes =
    trimmedValue.length >= 2 &&
    ((firstCharacter === '"' && lastCharacter === '"') ||
      (firstCharacter === "'" && lastCharacter === "'"));

  return hasSurroundingQuotes ? trimmedValue.slice(1, -1) : trimmedValue;
};

const parseDotEnv = (rawText) => {
  const safeRawText = typeof rawText === "string" ? rawText : "";

  if (safeRawText === "") {
    return {};
  }

  const parsedEntries = safeRawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) {
        return null;
      }

      const key = line.slice(0, equalsIndex).trim();
      const valueText = line.slice(equalsIndex + 1);
      const withoutComment = stripDotEnvComment(valueText);
      const value = stripSurroundingQuotes(withoutComment);

      return [key, value];
    })
    .filter((entry) => entry !== null);

  return Object.fromEntries(parsedEntries);
};

const pickFirstNonEmptyString = (values, fallbackValue) => {
  const firstMatch = values.find((value) => typeof value === "string" && value !== "");
  if (typeof firstMatch === "string") {
    return firstMatch;
  }
  return fallbackValue;
};

const resolveFromConfigText = (resolutionInput) => {
  if (resolutionInput.configText === "") {
    return null;
  }

  const parsedConfig = parseMemoryMasonConfig(resolutionInput.configText);
  const resolvedConfig = {
    vaultPath: expandHomePath(parsedConfig.vaultPath, resolutionInput.homedir),
    subfolder: parsedConfig.subfolder,
  };

  return typeof parsedConfig.sync === "boolean"
    ? { ...resolvedConfig, sync: parsedConfig.sync }
    : resolvedConfig;
};

const resolveFromDotEnvVaultPath = (resolutionInput) => {
  if (resolutionInput.dotEnvVaultPath === "") {
    return null;
  }

  return {
    vaultPath: expandHomePath(resolutionInput.dotEnvVaultPath, resolutionInput.homedir),
    subfolder: pickFirstNonEmptyString([resolutionInput.dotEnvSubfolder], DEFAULT_SUBFOLDER),
  };
};

const resolveFromGlobalConfigText = (resolutionInput) => {
  if (resolutionInput.globalConfigText === "") {
    return null;
  }

  const parsedGlobalConfig = parseMemoryMasonConfig(resolutionInput.globalConfigText);
  const resolvedConfig = {
    vaultPath: expandHomePath(parsedGlobalConfig.vaultPath, resolutionInput.homedir),
    subfolder: parsedGlobalConfig.subfolder,
  };

  return typeof parsedGlobalConfig.sync === "boolean"
    ? { ...resolvedConfig, sync: parsedGlobalConfig.sync }
    : resolvedConfig;
};

const resolveFromGlobalDotEnv = (resolutionInput) => {
  if (resolutionInput.globalDotEnvVaultPath === "") {
    return null;
  }

  return {
    vaultPath: expandHomePath(resolutionInput.globalDotEnvVaultPath, resolutionInput.homedir),
    subfolder: pickFirstNonEmptyString([resolutionInput.globalDotEnvSubfolder], DEFAULT_SUBFOLDER),
  };
};

const resolveVaultConfigFromAlternatives = (resolutionInput) => {
  const alternatives = [
    resolveFromDotEnvVaultPath,
    resolveFromConfigText,
    resolveFromGlobalDotEnv,
    resolveFromGlobalConfigText,
  ];

  return alternatives.reduce((resolvedConfig, resolveAlternative) => {
    if (resolvedConfig !== null) {
      return resolvedConfig;
    }

    return resolveAlternative(resolutionInput);
  }, null);
};

const resolveEnvOverrides = (env) => {
  const safeEnv = env !== null && typeof env === "object" ? env : {};
  const envSync = typeof safeEnv[ENV_KEY_SYNC] === "string" ? safeEnv[ENV_KEY_SYNC] : "";
  const envCaptureMode =
    typeof safeEnv[ENV_KEY_CAPTURE_MODE] === "string" ? safeEnv[ENV_KEY_CAPTURE_MODE] : "";

  return {
    syncFromEnv: parseEnvSyncOrNull(envSync),
    captureModeFromEnv: parseEnvCaptureModeOrNull(envCaptureMode),
  };
};

const parseDotEnvSource = (dotEnvText) => {
  const parsedDotEnv = parseDotEnv(dotEnvText);
  const vaultPath =
    typeof parsedDotEnv[ENV_KEY_VAULT_PATH] === "string" ? parsedDotEnv[ENV_KEY_VAULT_PATH] : "";
  const subfolder =
    typeof parsedDotEnv[ENV_KEY_SUBFOLDER] === "string" ? parsedDotEnv[ENV_KEY_SUBFOLDER] : "";
  const syncValue =
    typeof parsedDotEnv[ENV_KEY_SYNC] === "string" ? parsedDotEnv[ENV_KEY_SYNC] : "";
  const captureModeValue =
    typeof parsedDotEnv[ENV_KEY_CAPTURE_MODE] === "string"
      ? parsedDotEnv[ENV_KEY_CAPTURE_MODE]
      : "";

  return {
    vaultPath,
    subfolder,
    sync: parseEnvSyncOrNull(syncValue),
    captureMode: parseEnvCaptureModeOrNull(captureModeValue),
  };
};

const resolveProjectConfigSource = (configText) => {
  return {
    captureMode: parseConfigCaptureModeOrNull(configText),
  };
};

const resolveGlobalConfigSource = (globalConfigText) => {
  return {
    captureMode: parseConfigCaptureModeOrNull(globalConfigText),
  };
};

const resolveConfigSync = (resolvedConfig, syncFromGlobalDotEnv, syncFromDotEnv, syncFromEnv) => {
  let sync = true;

  if (typeof resolvedConfig.sync === "boolean") {
    sync = resolvedConfig.sync;
  }

  if (typeof syncFromGlobalDotEnv === "boolean") {
    sync = syncFromGlobalDotEnv;
  }

  if (typeof syncFromDotEnv === "boolean") {
    sync = syncFromDotEnv;
  }

  if (typeof syncFromEnv === "boolean") {
    sync = syncFromEnv;
  }

  return sync;
};

const resolveConfigCaptureMode = (
  globalConfigCaptureMode,
  configCaptureMode,
  captureModeFromGlobalDotEnv,
  captureModeFromDotEnv,
  envCaptureMode,
) => {
  let captureMode = DEFAULT_CAPTURE_MODE;

  if (typeof globalConfigCaptureMode === "string") {
    captureMode = globalConfigCaptureMode;
  }

  if (typeof configCaptureMode === "string") {
    captureMode = configCaptureMode;
  }

  if (typeof captureModeFromGlobalDotEnv === "string") {
    captureMode = captureModeFromGlobalDotEnv;
  }

  if (typeof captureModeFromDotEnv === "string") {
    captureMode = captureModeFromDotEnv;
  }

  if (typeof envCaptureMode === "string") {
    captureMode = envCaptureMode;
  }

  return captureMode;
};

const resolveVaultConfig = (cwd, configText, homedir, options = {}) => {
  const safeHomedir = assertNonEmptyString("homedir", homedir);
  const safeConfigText = typeof configText === "string" ? configText : "";
  const safeOptions = options !== null && typeof options === "object" ? options : {};
  const safeDotEnvText = typeof safeOptions.dotEnvText === "string" ? safeOptions.dotEnvText : "";
  const safeGlobalConfigText =
    typeof safeOptions.globalConfigText === "string" ? safeOptions.globalConfigText : "";
  const safeGlobalDotEnvText =
    typeof safeOptions.globalDotEnvText === "string" ? safeOptions.globalDotEnvText : "";
  const envSource = resolveEnvOverrides(process.env);
  const projectConfigSource = resolveProjectConfigSource(safeConfigText);
  const globalConfigSource = resolveGlobalConfigSource(safeGlobalConfigText);
  const projectDotEnvSource = parseDotEnvSource(safeDotEnvText);
  const globalDotEnvSource = parseDotEnvSource(safeGlobalDotEnvText);

  const resolutionInput = {
    homedir: safeHomedir,
    configText: safeConfigText,
    dotEnvVaultPath: projectDotEnvSource.vaultPath,
    dotEnvSubfolder: projectDotEnvSource.subfolder,
    globalConfigText: safeGlobalConfigText,
    globalDotEnvVaultPath: globalDotEnvSource.vaultPath,
    globalDotEnvSubfolder: globalDotEnvSource.subfolder,
  };

  const resolvedConfig = resolveVaultConfigFromAlternatives(resolutionInput);
  if (resolvedConfig === null) {
    assertNonEmptyString("cwd", cwd);
    throw new Error(
      "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  }

  const sync = resolveConfigSync(
    resolvedConfig,
    globalDotEnvSource.sync,
    projectDotEnvSource.sync,
    envSource.syncFromEnv,
  );
  const captureMode = resolveConfigCaptureMode(
    globalConfigSource.captureMode,
    projectConfigSource.captureMode,
    globalDotEnvSource.captureMode,
    projectDotEnvSource.captureMode,
    envSource.captureModeFromEnv,
  );

  return {
    vaultPath: resolvedConfig.vaultPath,
    subfolder: resolvedConfig.subfolder,
    sync,
    captureMode,
  };
};

const detectPlatform = (input) => {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length === 0
  ) {
    throw new Error("input must be a non-empty object");
  }

  if (typeof input.hookEventName === "string") {
    return PLATFORM_COPILOT_VSCODE;
  }

  if (typeof input.hook_event_name === "string" && typeof input.turn_id === "string") {
    return PLATFORM_CODEX;
  }

  if (typeof input.hook_event_name === "string") {
    return PLATFORM_CLAUDE_CODE;
  }

  if (
    typeof input.timestamp !== "undefined" &&
    typeof input.hook_event_name === "undefined" &&
    typeof input.hookEventName === "undefined"
  ) {
    return PLATFORM_COPILOT_CLI;
  }

  throw new Error(`cannot detect platform from stdin shape: ${JSON.stringify(Object.keys(input))}`);
};

module.exports = {
  parseJsonInput,
  assertNonEmptyString,
  expandHomePath,
  parseMemoryMasonConfig,
  parseDotEnv,
  resolveVaultConfig,
  detectPlatform,
};
