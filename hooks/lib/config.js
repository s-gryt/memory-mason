"use strict";

const assertNonEmptyString = (name, value) => {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};

const parseJsonInput = (rawStdin) => {
  assertNonEmptyString("stdin", rawStdin);

  try {
    const parsed = JSON.parse(rawStdin);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`invalid JSON in stdin: ${rawStdin.slice(0, 200)}`);
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
      throw new Error(`invalid JSON in stdin: ${rawStdin.slice(0, 200)}`);
    }
    return parsedEscaped;
  } catch (_error) {
    throw new Error(`invalid JSON in stdin: ${rawStdin.slice(0, 200)}`);
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

const parseConfigSyncOrNull = (configText) => {
  const parsedConfig = parseConfigObjectOrNull(configText);
  if (parsedConfig === null) {
    return null;
  }

  return parseSyncFieldFromConfigObject(parsedConfig);
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

  throw new Error(`MEMORY_MASON_SYNC must be 'true' or 'false', got: ${envSyncValue}`);
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

const parseConfigSubfolderOrEmpty = (configText) => {
  if (configText === "") {
    return "";
  }

  try {
    return parseMemoryMasonConfig(configText).subfolder;
  } catch (_error) {
    return "";
  }
};

const resolveFromEnvVaultPath = (resolutionInput) => {
  if (resolutionInput.envVaultPath === "") {
    return null;
  }

  const configSync = parseConfigSyncOrNull(resolutionInput.configText);
  const subfolderFromConfig = parseConfigSubfolderOrEmpty(resolutionInput.configText);
  const resolvedConfig = {
    vaultPath: expandHomePath(resolutionInput.envVaultPath, resolutionInput.homedir),
    subfolder: pickFirstNonEmptyString(
      [subfolderFromConfig, resolutionInput.dotEnvSubfolder],
      "ai-knowledge",
    ),
  };

  return typeof configSync === "boolean" ? { ...resolvedConfig, sync: configSync } : resolvedConfig;
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
    subfolder: pickFirstNonEmptyString([resolutionInput.dotEnvSubfolder], "ai-knowledge"),
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
    subfolder: pickFirstNonEmptyString([resolutionInput.globalDotEnvSubfolder], "ai-knowledge"),
  };
};

const resolveVaultConfigFromAlternatives = (resolutionInput) => {
  const alternatives = [
    resolveFromEnvVaultPath,
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

const resolveVaultConfig = (cwd, envVaultPath, configText, homedir, options = {}) => {
  const safeHomedir = assertNonEmptyString("homedir", homedir);
  const safeEnvVaultPath = typeof envVaultPath === "string" ? envVaultPath : "";
  const safeConfigText = typeof configText === "string" ? configText : "";
  const safeOptions = options !== null && typeof options === "object" ? options : {};
  const safeEnvSync =
    typeof process.env.MEMORY_MASON_SYNC === "string" ? process.env.MEMORY_MASON_SYNC : "";
  const safeDotEnvText = typeof safeOptions.dotEnvText === "string" ? safeOptions.dotEnvText : "";
  const safeGlobalConfigText =
    typeof safeOptions.globalConfigText === "string" ? safeOptions.globalConfigText : "";
  const safeGlobalDotEnvText =
    typeof safeOptions.globalDotEnvText === "string" ? safeOptions.globalDotEnvText : "";
  const syncFromEnv = parseEnvSyncOrNull(safeEnvSync);
  const parsedDotEnv = parseDotEnv(safeDotEnvText);
  const dotEnvVaultPath =
    typeof parsedDotEnv.MEMORY_MASON_VAULT_PATH === "string"
      ? parsedDotEnv.MEMORY_MASON_VAULT_PATH
      : "";
  const dotEnvSubfolder =
    typeof parsedDotEnv.MEMORY_MASON_SUBFOLDER === "string"
      ? parsedDotEnv.MEMORY_MASON_SUBFOLDER
      : "";
  const dotEnvSync =
    typeof parsedDotEnv.MEMORY_MASON_SYNC === "string" ? parsedDotEnv.MEMORY_MASON_SYNC : "";
  const syncFromDotEnv = parseEnvSyncOrNull(dotEnvSync);
  const parsedGlobalDotEnv = parseDotEnv(safeGlobalDotEnvText);
  const globalDotEnvVaultPath =
    typeof parsedGlobalDotEnv.MEMORY_MASON_VAULT_PATH === "string"
      ? parsedGlobalDotEnv.MEMORY_MASON_VAULT_PATH
      : "";
  const globalDotEnvSubfolder =
    typeof parsedGlobalDotEnv.MEMORY_MASON_SUBFOLDER === "string"
      ? parsedGlobalDotEnv.MEMORY_MASON_SUBFOLDER
      : "";
  const globalDotEnvSync =
    typeof parsedGlobalDotEnv.MEMORY_MASON_SYNC === "string"
      ? parsedGlobalDotEnv.MEMORY_MASON_SYNC
      : "";
  const syncFromGlobalDotEnv = parseEnvSyncOrNull(globalDotEnvSync);

  const resolutionInput = {
    homedir: safeHomedir,
    envVaultPath: safeEnvVaultPath,
    configText: safeConfigText,
    dotEnvVaultPath,
    dotEnvSubfolder,
    globalConfigText: safeGlobalConfigText,
    globalDotEnvVaultPath,
    globalDotEnvSubfolder,
  };

  const resolvedConfig = resolveVaultConfigFromAlternatives(resolutionInput);
  if (resolvedConfig !== null) {
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

    return {
      vaultPath: resolvedConfig.vaultPath,
      subfolder: resolvedConfig.subfolder,
      sync,
    };
  }

  assertNonEmptyString("cwd", cwd);
  throw new Error(
    "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
  );
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
    return "copilot-vscode";
  }

  if (typeof input.hook_event_name === "string" && typeof input.turn_id === "string") {
    return "codex";
  }

  if (typeof input.hook_event_name === "string") {
    return "claude-code";
  }

  if (
    typeof input.timestamp !== "undefined" &&
    typeof input.hook_event_name === "undefined" &&
    typeof input.hookEventName === "undefined"
  ) {
    return "copilot-cli";
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
