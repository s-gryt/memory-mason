#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseJsonInput, detectPlatform, resolveVaultConfig } = require("./lib/config");
const { buildCommandErrorResult, writeIfPresent } = require("./lib/cli");
const { buildDailyEntry, localNow } = require("./lib/vault");
const { appendToDaily } = require("./lib/writer");
const { loadCaptureState, getMmSuppressed } = require("./lib/capture-state");

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

function serializeToolResponse(toolResponse) {
  if (typeof toolResponse === "string") {
    return toolResponse;
  }

  if (Array.isArray(toolResponse)) {
    const textBlocks = toolResponse
      .filter(
        (block) =>
          block !== null &&
          typeof block === "object" &&
          !Array.isArray(block) &&
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim() !== "",
      )
      .map((block) => block.text.trim());

    if (textBlocks.length > 0) {
      return textBlocks.join("\n");
    }

    return JSON.stringify(toolResponse, null, 2);
  }

  if (toolResponse !== null && typeof toolResponse === "object") {
    return JSON.stringify(toolResponse, null, 2);
  }

  return "";
}

function extractClaudeOrCopilotVscodePayload(input) {
  return {
    toolName: toStringOrEmpty(input.tool_name),
    resultText: serializeToolResponse(input.tool_response),
  };
}

function extractCopilotCliPayload(input) {
  const toolResult =
    input.toolResult !== null &&
    typeof input.toolResult === "object" &&
    !Array.isArray(input.toolResult)
      ? input.toolResult
      : {};
  const textResultForLlm =
    typeof toolResult.textResultForLlm === "string" ? toolResult.textResultForLlm : "";

  return {
    toolName: toStringOrEmpty(input.toolName),
    resultText: textResultForLlm,
  };
}

function extractCodexPayload(input) {
  return {
    toolName: toStringOrEmpty(input.tool_name),
    resultText: toStringOrEmpty(input.tool_result),
  };
}

function extractToolPayload(platform, input) {
  const extractorByPlatform = {
    "claude-code": extractClaudeOrCopilotVscodePayload,
    "copilot-vscode": extractClaudeOrCopilotVscodePayload,
    "copilot-cli": extractCopilotCliPayload,
    codex: extractCodexPayload,
  };
  const extractor = extractorByPlatform[platform];

  if (typeof extractor === "function") {
    return extractor(input);
  }

  throw new Error(`unsupported platform: ${platform}`);
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

function buildCaptureTimestamp() {
  const now = localNow();
  return {
    today: now.date,
    timestamp: now.time,
  };
}

function buildNoisyToolList() {
  return ["Read", "Glob", "LS", "List", "ls", "read", "glob"];
}

function shouldSkipToolPayload(payload, noisyTools) {
  return payload.toolName === "" || noisyTools.includes(payload.toolName);
}

function buildRunPlan(rawStdin, runtime = {}) {
  const env = resolveRuntimeEnv(runtime);
  const fallbackCwd = resolveFallbackCwd(runtime);
  const homedir = resolveRuntimeHomedir(runtime);
  const input = parseJsonInput(rawStdin);
  const platform = detectPlatform(input);
  const payload = extractToolPayload(platform, input);
  const captureTimestamp = buildCaptureTimestamp();

  return {
    env,
    homedir,
    cwd: resolveInputCwd(input, fallbackCwd),
    payload,
    today: captureTimestamp.today,
    timestamp: captureTimestamp.timestamp,
    noisyTools: buildNoisyToolList(),
  };
}

function persistToolUsage(plan, resolvedConfig) {
  const dailyEntry = buildDailyEntry(
    plan.payload.toolName,
    plan.payload.resultText,
    plan.timestamp,
  );
  appendToDaily(resolvedConfig.vaultPath, resolvedConfig.subfolder, plan.today, dailyEntry);
}

function run(rawStdin, runtime = {}) {
  const env = runtime.env !== null && typeof runtime.env === "object" ? runtime.env : process.env;

  if (toStringOrEmpty(env.MEMORY_MASON_INVOKED_BY) !== "") {
    return { status: 0, stdout: "", stderr: "" };
  }

  try {
    const plan = buildRunPlan(rawStdin, runtime);
    const resolvedConfig = resolveRuntimeConfig(plan.cwd, plan.env, plan.homedir);

    if (resolvedConfig.sync === false) {
      return { status: 0, stdout: "", stderr: "" };
    }

    const captureState = loadCaptureState(resolvedConfig.vaultPath, resolvedConfig.subfolder);

    if (getMmSuppressed(captureState)) {
      return { status: 0, stdout: "", stderr: "" };
    }

    if (shouldSkipToolPayload(plan.payload, plan.noisyTools)) {
      return { status: 0, stdout: "", stderr: "" };
    }

    persistToolUsage(plan, resolvedConfig);
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
  serializeToolResponse,
  extractToolPayload,
  readDotEnvText,
  readGlobalConfigText,
  readGlobalDotEnvText,
  run,
  main,
};
