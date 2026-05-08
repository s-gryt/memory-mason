/**
 * This module handles hook runtime logic.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { resolveVaultConfig } = require("../config/config");
const { writeIfPresent } = require("../cli/cli");
const { STDIN_BUFFER_BYTES } = require("./constants");
const { UTF8_ENCODING } = require("../shared/constants");
const {
  PROJECT_CONFIG_FILE_NAME,
  DOTENV_FILE_NAME,
  GLOBAL_MM_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
} = require("../config/constants");

function chooseFirst(candidates, predicate) {
  return candidates.find((value) => predicate(value));
}

function isNonNullObject(value) {
  return [typeof value === "object", value !== null].every(Boolean);
}

function isFunctionValue(value) {
  return typeof value === "function";
}

function readStdin(fsApi = fs) {
  const fd = 0;

  function readChunks() {
    const chunk = Buffer.alloc(STDIN_BUFFER_BYTES);
    const bytesRead = fsApi.readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead <= 0) {
      return [];
    }
    return [chunk.slice(0, bytesRead)].concat(readChunks());
  }

  return Buffer.concat(readChunks()).toString(UTF8_ENCODING);
}

function toStringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function firstNonEmptyString(values) {
  const match = values.find((value) => typeof value === "string" && value !== "");
  return typeof match === "string" ? match : "";
}

function readConfigText(cwd) {
  const configPath = path.join(cwd, PROJECT_CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) {
    return "";
  }
  return fs.readFileSync(configPath, UTF8_ENCODING);
}

function readDotEnvText(cwd) {
  const envPath = path.join(cwd, DOTENV_FILE_NAME);
  if (!fs.existsSync(envPath)) {
    return "";
  }
  return fs.readFileSync(envPath, UTF8_ENCODING);
}

function readGlobalConfigText(homedir) {
  const globalConfigPath = path.join(homedir, GLOBAL_MM_DIR_NAME, GLOBAL_CONFIG_FILE_NAME);
  if (!fs.existsSync(globalConfigPath)) {
    return "";
  }
  return fs.readFileSync(globalConfigPath, UTF8_ENCODING);
}

function readGlobalDotEnvText(homedir) {
  const globalEnvPath = path.join(homedir, GLOBAL_MM_DIR_NAME, DOTENV_FILE_NAME);
  if (!fs.existsSync(globalEnvPath)) {
    return "";
  }
  return fs.readFileSync(globalEnvPath, UTF8_ENCODING);
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

function resolveRuntimeContext(runtime = {}) {
  return {
    env: resolveRuntimeEnv(runtime),
    fallbackCwd: resolveFallbackCwd(runtime),
    homedir: resolveRuntimeHomedir(runtime),
  };
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

function resolveRuntimeConfig(cwd, homedir) {
  const configSources = readConfigSources(cwd, homedir);
  return resolveVaultConfig(cwd, configSources.configText, homedir, {
    dotEnvText: configSources.dotEnvText,
    globalConfigText: configSources.globalConfigText,
    globalDotEnvText: configSources.globalDotEnvText,
  });
}

function resolveTranscriptPath(input) {
  return firstNonEmptyString([
    toStringOrEmpty(input.transcript_path),
    toStringOrEmpty(input.transcriptPath),
  ]);
}

function buildSuccessResult(stdout = "") {
  return {
    status: 0,
    stdout,
    stderr: "",
  };
}

const resolveIoHandlers = (io) => ({
  stdout: chooseFirst([io.stdout, (text) => process.stdout.write(text)], isFunctionValue),
  stderr: chooseFirst([io.stderr, (text) => process.stderr.write(text)], isFunctionValue),
  exit: chooseFirst([io.exit, (code) => process.exit(code)], isFunctionValue),
});

const dispatchHookResult = (result, ioHandlers) => {
  writeIfPresent(result.stdout, ioHandlers.stdout);
  writeIfPresent(result.stderr, ioHandlers.stderr);
  ioHandlers.exit(result.status);
  return result;
};

function runStdinMain(runtime = {}, run) {
  const io = chooseFirst([runtime.io, {}], isNonNullObject);
  const ioHandlers = resolveIoHandlers(io);
  const fsApi = chooseFirst([runtime.fs, fs], isNonNullObject);
  const result = run(readStdin(fsApi), runtime);
  return dispatchHookResult(result, ioHandlers);
}

module.exports = {
  readStdin,
  toStringOrEmpty,
  firstNonEmptyString,
  readConfigText,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  chooseFirst,
  isNonNullObject,
  resolveRuntimeEnv,
  resolveFallbackCwd,
  resolveRuntimeHomedir,
  resolveRuntimeContext,
  resolveInputCwd,
  readConfigSources,
  resolveRuntimeConfig,
  resolveTranscriptPath,
  buildSuccessResult,
  resolveIoHandlers,
  dispatchHookResult,
  runStdinMain,
};
