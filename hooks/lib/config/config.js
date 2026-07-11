/**
 * This module handles config logic.
 */
"use strict";

const {
  CAPTURE_MODE_LITE,
  CAPTURE_MODE_FULL,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_SUBFOLDER,
  DEFAULT_MINIMIZE,
  ENV_KEY_VAULT_PATH,
  ENV_KEY_SUBFOLDER,
  ENV_KEY_SYNC,
  ENV_KEY_CAPTURE_MODE,
  ENV_KEY_MINIMIZE,
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

const parseMinimizeFromConfigObject = (parsedConfig) => {
  if (!Object.hasOwn(parsedConfig, "minimize")) {
    return null;
  }

  if (typeof parsedConfig.minimize === "boolean") {
    return parsedConfig.minimize;
  }

  throw new Error(
    `config minimize must be a boolean, got: ${describeValueType(parsedConfig.minimize)}`,
  );
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

const parseConfigFieldOrNull = (configText, parseField) => {
  const parsedConfig = parseConfigObjectOrNull(configText);
  if (parsedConfig === null) {
    return null;
  }

  return parseField(parsedConfig);
};

const parseConfigCaptureModeOrNull = (configText) =>
  parseConfigFieldOrNull(configText, parseCaptureModeFromConfigObject);

const parseConfigMinimizeOrNull = (configText) =>
  parseConfigFieldOrNull(configText, parseMinimizeFromConfigObject);

const parseConfigVaultPathOrNull = (configText) =>
  parseConfigFieldOrNull(configText, (parsedConfig) =>
    typeof parsedConfig.vaultPath === "string" && parsedConfig.vaultPath !== ""
      ? parsedConfig.vaultPath
      : null,
  );

const parseConfigSubfolderOrNull = (configText) =>
  parseConfigFieldOrNull(configText, (parsedConfig) =>
    typeof parsedConfig.subfolder === "string" && parsedConfig.subfolder !== ""
      ? parsedConfig.subfolder
      : null,
  );

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

const parseEnvMinimizeOrNull = (envValue) => {
  if (typeof envValue !== "string" || envValue === "") {
    return null;
  }

  if (envValue === "false") {
    return false;
  }

  if (envValue === "true") {
    return true;
  }

  throw new Error(`${ENV_KEY_MINIMIZE} must be 'true' or 'false', got: ${envValue}`);
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
      /* v8 ignore else -- guard-clause return, else-fallthrough exercised by other suite tests */
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
  if (resolutionInput.projectConfig.vaultPath === null) {
    return null;
  }

  return {
    vaultPath: expandHomePath(resolutionInput.projectConfig.vaultPath, resolutionInput.homedir),
  };
};

const resolveFromDotEnvVaultPath = (resolutionInput) => {
  if (resolutionInput.dotEnvVaultPath === "") {
    return null;
  }

  return {
    vaultPath: expandHomePath(resolutionInput.dotEnvVaultPath, resolutionInput.homedir),
  };
};

const resolveFromGlobalConfigText = (resolutionInput) => {
  if (resolutionInput.globalConfig.vaultPath === null) {
    return null;
  }

  return {
    vaultPath: expandHomePath(resolutionInput.globalConfig.vaultPath, resolutionInput.homedir),
  };
};

const resolveFromGlobalDotEnv = (resolutionInput) => {
  if (resolutionInput.globalDotEnvVaultPath === "") {
    return null;
  }

  return {
    vaultPath: expandHomePath(resolutionInput.globalDotEnvVaultPath, resolutionInput.homedir),
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
    /* v8 ignore else -- guard-clause return, else-fallthrough exercised by other suite tests */
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
  const envMinimize =
    typeof safeEnv[ENV_KEY_MINIMIZE] === "string" ? safeEnv[ENV_KEY_MINIMIZE] : "";

  return {
    syncFromEnv: parseEnvSyncOrNull(envSync),
    captureModeFromEnv: parseEnvCaptureModeOrNull(envCaptureMode),
    minimizeFromEnv: parseEnvMinimizeOrNull(envMinimize),
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
  const minimizeValue =
    typeof parsedDotEnv[ENV_KEY_MINIMIZE] === "string" ? parsedDotEnv[ENV_KEY_MINIMIZE] : "";

  return {
    vaultPath,
    subfolder,
    sync: parseEnvSyncOrNull(syncValue),
    captureMode: parseEnvCaptureModeOrNull(captureModeValue),
    minimize: parseEnvMinimizeOrNull(minimizeValue),
  };
};

const resolveProjectConfigSource = (configText) => {
  return {
    vaultPath: parseConfigVaultPathOrNull(configText),
    subfolder: parseConfigSubfolderOrNull(configText),
    sync: parseConfigFieldOrNull(configText, parseSyncFieldFromConfigObject),
    captureMode: parseConfigCaptureModeOrNull(configText),
    minimize: parseConfigMinimizeOrNull(configText),
  };
};

const resolveGlobalConfigSource = (globalConfigText) => {
  return {
    vaultPath: parseConfigVaultPathOrNull(globalConfigText),
    subfolder: parseConfigSubfolderOrNull(globalConfigText),
    sync: parseConfigFieldOrNull(globalConfigText, parseSyncFieldFromConfigObject),
    captureMode: parseConfigCaptureModeOrNull(globalConfigText),
    minimize: parseConfigMinimizeOrNull(globalConfigText),
  };
};

const resolveScalarByPrecedence = (values, fallbackValue) => {
  const reversedValues = [...values].reverse();
  const resolvedValue = reversedValues.find(
    (value) => value !== null && typeof value !== "undefined",
  );
  return typeof resolvedValue === "undefined" ? fallbackValue : resolvedValue;
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
    projectConfig: projectConfigSource,
    dotEnvVaultPath: projectDotEnvSource.vaultPath,
    globalConfig: globalConfigSource,
    globalDotEnvVaultPath: globalDotEnvSource.vaultPath,
  };

  const resolvedConfig = resolveVaultConfigFromAlternatives(resolutionInput);
  /* v8 ignore else -- guard-clause throw, else-fallthrough exercised by other suite tests */
  if (resolvedConfig === null) {
    assertNonEmptyString("cwd", cwd);
    throw new Error(
      "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  }

  const subfolder = pickFirstNonEmptyString(
    [
      projectDotEnvSource.subfolder,
      projectConfigSource.subfolder,
      globalDotEnvSource.subfolder,
      globalConfigSource.subfolder,
    ],
    DEFAULT_SUBFOLDER,
  );
  const sync = resolveScalarByPrecedence(
    [
      globalConfigSource.sync,
      globalDotEnvSource.sync,
      projectConfigSource.sync,
      projectDotEnvSource.sync,
      envSource.syncFromEnv,
    ],
    true,
  );
  const captureMode = resolveScalarByPrecedence(
    [
      globalConfigSource.captureMode,
      globalDotEnvSource.captureMode,
      projectConfigSource.captureMode,
      projectDotEnvSource.captureMode,
      envSource.captureModeFromEnv,
    ],
    DEFAULT_CAPTURE_MODE,
  );
  const minimize = resolveScalarByPrecedence(
    [
      globalConfigSource.minimize,
      globalDotEnvSource.minimize,
      projectConfigSource.minimize,
      projectDotEnvSource.minimize,
      envSource.minimizeFromEnv,
    ],
    DEFAULT_MINIMIZE,
  );

  return {
    vaultPath: resolvedConfig.vaultPath,
    subfolder,
    sync,
    captureMode,
    minimize,
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
  resolveEnvOverrides,
  resolveVaultConfig,
  detectPlatform,
};
