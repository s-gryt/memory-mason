'use strict';

const assertNonEmptyString = (name, value) => {
  if (typeof value !== 'string' || value === '') {
    throw new Error(name + ' must be a non-empty string');
  }
  return value;
};

const parseJsonInput = (rawStdin) => {
  assertNonEmptyString('stdin', rawStdin);

  try {
    const parsed = JSON.parse(rawStdin);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid JSON in stdin: ' + rawStdin.slice(0, 200));
    }
    return parsed;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  try {
    const escapedStdin = rawStdin.replace(/(?<!\\)\\(?!["\\])/g, '\\\\');
    const parsedEscaped = JSON.parse(escapedStdin);
    if (parsedEscaped === null || typeof parsedEscaped !== 'object' || Array.isArray(parsedEscaped)) {
      throw new Error('invalid JSON in stdin: ' + rawStdin.slice(0, 200));
    }
    return parsedEscaped;
  } catch (error) {
    throw new Error('invalid JSON in stdin: ' + rawStdin.slice(0, 200));
  }
};

const expandHomePath = (inputPath, homedir) => {
  const safeInputPath = assertNonEmptyString('inputPath', inputPath);
  const safeHomedir = assertNonEmptyString('homedir', homedir);
  if (/^~(?=$|[\\/])/.test(safeInputPath)) {
    return safeInputPath.replace(/^~(?=$|[\\/])/, safeHomedir);
  }
  return safeInputPath;
};

const parseMemoryMasonConfig = (rawText) => {
  assertNonEmptyString('rawText', rawText);

  const parsed = (() => {
    try {
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error('invalid memory-mason config JSON');
    }
  })();

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('memory-mason config must be an object');
  }

  const vaultPath = assertNonEmptyString('vaultPath', parsed.vaultPath);
  const subfolder = assertNonEmptyString('subfolder', parsed.subfolder);
  return { vaultPath, subfolder };
};

const resolveVaultConfig = (cwd, envVaultPath, configText, homedir) => {
  const safeHomedir = assertNonEmptyString('homedir', homedir);
  const safeEnvVaultPath = typeof envVaultPath === 'string' ? envVaultPath : '';
  const safeConfigText = typeof configText === 'string' ? configText : '';

  if (safeEnvVaultPath !== '') {
    return {
      vaultPath: expandHomePath(safeEnvVaultPath, safeHomedir),
      subfolder: 'ai-knowledge'
    };
  }

  if (safeConfigText !== '') {
    const parsedConfig = parseMemoryMasonConfig(safeConfigText);
    return {
      vaultPath: expandHomePath(parsedConfig.vaultPath, safeHomedir),
      subfolder: parsedConfig.subfolder
    };
  }

  assertNonEmptyString('cwd', cwd);
  throw new Error('memory-mason.json not found and MEMORY_MASON_VAULT_PATH is not set');
};

const detectPlatform = (input) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length === 0) {
    throw new Error('input must be a non-empty object');
  }

  if (typeof input.hookEventName === 'string') {
    return 'copilot-vscode';
  }

  if (typeof input.hook_event_name === 'string' && typeof input.turn_id === 'string') {
    return 'codex';
  }

  if (typeof input.hook_event_name === 'string') {
    return 'claude-code';
  }

  if (
    typeof input.timestamp !== 'undefined' &&
    typeof input.hook_event_name === 'undefined' &&
    typeof input.hookEventName === 'undefined'
  ) {
    return 'copilot-cli';
  }

  throw new Error('cannot detect platform from stdin shape: ' + JSON.stringify(Object.keys(input)));
};

module.exports = {
  parseJsonInput,
  assertNonEmptyString,
  expandHomePath,
  parseMemoryMasonConfig,
  resolveVaultConfig,
  detectPlatform
};