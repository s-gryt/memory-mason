"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { resolveVaultConfig } = require("./config");
const { writeIfPresent } = require("./cli");

const STDIN_BUFFER_BYTES = 65536;

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

  return Buffer.concat(readChunks()).toString("utf-8");
}

function toStringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function firstNonEmptyString(values) {
  const match = values.find((value) => typeof value === "string" && value !== "");
  return typeof match === "string" ? match : "";
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

function runStdinMain(runtime = {}, run) {
  const io = chooseFirst([runtime.io, {}], isNonNullObject);
  const stdout = chooseFirst([io.stdout, (text) => process.stdout.write(text)], isFunctionValue);
  const stderr = chooseFirst([io.stderr, (text) => process.stderr.write(text)], isFunctionValue);
  const exit = chooseFirst([io.exit, (code) => process.exit(code)], isFunctionValue);
  const fsApi = chooseFirst([runtime.fs, fs], isNonNullObject);
  const result = run(readStdin(fsApi), runtime);
  writeIfPresent(result.stdout, stdout);
  writeIfPresent(result.stderr, stderr);
  exit(result.status);
  return result;
}

module.exports = {
  readStdin,
  toStringOrEmpty,
  firstNonEmptyString,
  readConfigText,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  resolveRuntimeEnv,
  resolveFallbackCwd,
  resolveRuntimeHomedir,
  resolveInputCwd,
  readConfigSources,
  resolveRuntimeConfig,
  resolveTranscriptPath,
  buildSuccessResult,
  runStdinMain,
};
