#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseJsonInput, resolveVaultConfig } = require("./lib/config");
const { buildCommandErrorResult, writeIfPresent } = require("./lib/cli");
const { buildFullTranscript } = require("./lib/transcript");
const { buildSessionHeader, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
const {
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getMmSuppressed,
} = require("./lib/capture-state");

const DUPLICATE_CAPTURE_WINDOW_MS = 60000;

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

function firstNonEmptyString(values) {
  if (!Array.isArray(values)) {
    throw new Error("values must be an array");
  }
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

function resolveTranscriptPath(input) {
  return firstNonEmptyString([
    toStringOrEmpty(input.transcript_path),
    toStringOrEmpty(input.transcriptPath),
  ]);
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

function shouldSkipForInvoker(env) {
  return toStringOrEmpty(env.MEMORY_MASON_INVOKED_BY) !== "";
}

function shouldSkipMissingTranscript(transcriptPath) {
  return transcriptPath === "" || !fs.existsSync(transcriptPath);
}

function shouldSkipShortTranscript(fullTranscript) {
  return fullTranscript.turnCount < 5;
}

function resolveSessionId(input) {
  return firstNonEmptyString([
    toStringOrEmpty(input.session_id),
    toStringOrEmpty(input.sessionId),
    "unknown",
  ]);
}

function buildCaptureTimestamp() {
  const now = localNow();
  return {
    iso: `${now.date}T${now.time}`,
    today: now.date,
  };
}

function buildDuplicateDecision(captureState, captureRecord) {
  return isDuplicateCapture(captureState.lastCapture, captureRecord, DUPLICATE_CAPTURE_WINDOW_MS);
}

function persistCapture(
  resolvedConfig,
  today,
  sessionHeader,
  fullTranscript,
  captureState,
  captureRecord,
) {
  appendToDaily(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    today,
    sessionHeader + fullTranscript.markdown,
  );
  saveCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder, {
    ...captureState,
    lastCapture: captureRecord,
  });
}

function run(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);

  if (shouldSkipForInvoker(env)) {
    return { status: 0, stdout: "", stderr: "" };
  }

  try {
    const input = parseJsonInput(rawStdin);
    const transcriptPath = resolveTranscriptPath(input);

    if (shouldSkipMissingTranscript(transcriptPath)) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const cwd = resolveInputCwd(input, fallbackCwd);
    const resolvedConfig = resolveRuntimeConfig(cwd, env, homedir);

    if (resolvedConfig.sync === false) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);

    if (getMmSuppressed(captureState)) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const transcriptContent = fs.readFileSync(transcriptPath, "utf-8");
    const fullTranscript = buildFullTranscript(transcriptContent);

    if (shouldSkipShortTranscript(fullTranscript)) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const captureTimestamp = buildCaptureTimestamp();
    const sessionId = resolveSessionId(input);
    const captureRecord = buildCaptureRecord(
      sessionId,
      "pre-compact",
      fullTranscript.markdown,
      Date.now(),
    );

    if (buildDuplicateDecision(captureState, captureRecord)) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const sessionHeader = buildSessionHeader(sessionId, "pre-compact", captureTimestamp.iso);
    persistCapture(
      resolvedConfig,
      captureTimestamp.today,
      sessionHeader,
      fullTranscript,
      captureState,
      captureRecord,
    );
    return { status: 0, stdout: "", stderr: "" };
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

/* c8 ignore next 3 */
if (require.main === module) {
  main();
}

module.exports = {
  readStdin,
  firstNonEmptyString,
  resolveTranscriptPath,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  run,
  main,
};
