"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const userPromptSubmit = require("../../user-prompt-submit");
const sessionStart = require("../../session-start");
const preCompact = require("../../pre-compact");
const postToolUse = require("../../post-tool-use");
const sessionEnd = require("../../session-end");
const installCopilotHooks = require("../../install-copilot-hooks");
const uninstallCopilotHooks = require("../../uninstall-copilot-hooks");
const { materializeProjectDotEnvConfig } = require("./project-dot-env");

const hooksRoot = path.resolve(__dirname, "..", "..");

const scriptModules = {
  "user-prompt-submit.js": userPromptSubmit,
  "session-start.js": sessionStart,
  "pre-compact.js": preCompact,
  "post-tool-use.js": postToolUse,
  "session-end.js": sessionEnd,
  "install-copilot-hooks.js": installCopilotHooks,
  "uninstall-copilot-hooks.js": uninstallCopilotHooks,
};

const runtimeOnlyScriptNames = new Set(["install-copilot-hooks.js", "uninstall-copilot-hooks.js"]);

const tempDirs = [];
const generatedEnvPaths = [];

const createTempDir = (prefix) => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dirPath);
  return dirPath;
};

const buildEnv = (homeDir, overrides = {}) => ({
  ...process.env,
  PATH: "",
  Path: "",
  HOME: homeDir,
  USERPROFILE: homeDir,
  ...overrides,
});

const hasEnvVaultPath = (env) =>
  env !== null &&
  typeof env === "object" &&
  typeof env.MEMORY_MASON_VAULT_PATH === "string" &&
  env.MEMORY_MASON_VAULT_PATH !== "";

const remapHooksRootCwd = (targetCwd, isolatedProjectCwd) =>
  targetCwd === hooksRoot && isolatedProjectCwd !== "" ? isolatedProjectCwd : targetCwd;

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const buildTranscript = (turns, firstUserContent = "user turn") => {
  if (Array.isArray(turns)) {
    return turns
      .map((turn, index) => {
        if (typeof turn === "string") {
          return turn;
        }

        const isObjectTurn = turn !== null && typeof turn === "object";
        const fallbackRole = index % 2 === 0 ? "user" : "assistant";
        const role =
          isObjectTurn && typeof turn.role === "string" && turn.role !== ""
            ? turn.role
            : fallbackRole;
        const content =
          isObjectTurn && typeof turn.content === "string" ? turn.content : `${role} turn ${index}`;

        return JSON.stringify({ message: { role, content } });
      })
      .join("\n");
  }

  const turnCount = Number.isInteger(turns) && turns > 0 ? turns : 0;
  return Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % 2 === 0;
    const role = isUser ? "user" : "assistant";
    const content = isUser && index === 0 ? firstUserContent : `${role} turn ${index}`;
    return JSON.stringify({ message: { role, content } });
  }).join("\n");
};

const cleanupGeneratedArtifacts = () => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }

  while (generatedEnvPaths.length > 0) {
    fs.rmSync(generatedEnvPaths.pop(), { force: true });
  }
};

const resolveScriptModule = (scriptPath) => {
  if (
    scriptPath !== null &&
    typeof scriptPath === "object" &&
    typeof scriptPath.run === "function"
  ) {
    return scriptPath;
  }

  if (typeof scriptPath !== "string" || scriptPath === "") {
    throw new Error("scriptPath must be a non-empty string or a module with run()");
  }

  const scriptName = path.basename(scriptPath);
  if (!Object.hasOwn(scriptModules, scriptName)) {
    throw new Error(`unsupported scriptPath: ${scriptPath}`);
  }

  return scriptModules[scriptName];
};

const resolveScriptName = (scriptPath) =>
  typeof scriptPath === "string" && scriptPath !== "" ? path.basename(scriptPath) : "";

const isObjectValue = (value) => value !== null && typeof value === "object";

const resolveRuntimeEnv = (options) => (isObjectValue(options.env) ? options.env : process.env);

const resolveRuntimeHomedir = (env) =>
  typeof env.USERPROFILE === "string" && env.USERPROFILE !== "" ? env.USERPROFILE : os.homedir();

const resolveExtraRuntime = (options) => (isObjectValue(options.runtime) ? options.runtime : {});

const resolveRequestedRuntimeCwd = (options) =>
  typeof options.cwd === "string" ? options.cwd : hooksRoot;

const resolvePayload = (options) =>
  isObjectValue(options.payload) && !Array.isArray(options.payload) ? options.payload : null;

const resolvePayloadCwd = (payload) =>
  payload !== null && typeof payload.cwd === "string" ? payload.cwd : "";

const resolveIsolatedProjectCwd = (env, requestedRuntimeCwd, payloadCwd) =>
  hasEnvVaultPath(env) && (requestedRuntimeCwd === hooksRoot || payloadCwd === hooksRoot)
    ? createTempDir("mm-cwd-")
    : "";

const resolvePayloadRuntimeValue = (payload, payloadCwd, isolatedProjectCwd) =>
  payload !== null && payloadCwd !== ""
    ? { ...payload, cwd: remapHooksRootCwd(payloadCwd, isolatedProjectCwd) }
    : payload;

const resolveStdinText = (options, resolvedPayload) => {
  if (typeof options.stdin === "string") {
    return options.stdin;
  }

  if (typeof options.stdinText === "string") {
    return options.stdinText;
  }

  if (resolvedPayload !== null) {
    return JSON.stringify(resolvedPayload);
  }

  return "";
};

const materializeRuntimeConfigs = (runtimeCwd, resolvedPayload, env) => {
  materializeProjectDotEnvConfig(runtimeCwd, env, generatedEnvPaths);

  const resolvedPayloadCwd = resolvePayloadCwd(resolvedPayload);
  if (resolvedPayloadCwd !== "" && resolvedPayloadCwd !== runtimeCwd) {
    materializeProjectDotEnvConfig(resolvedPayloadCwd, env, generatedEnvPaths);
  }
};

const normalizeHookResult = (rawResult) => {
  const status =
    rawResult !== null && typeof rawResult === "object" && Number.isInteger(rawResult.status)
      ? rawResult.status
      : 0;
  const stdout =
    rawResult !== null && typeof rawResult === "object" && typeof rawResult.stdout === "string"
      ? rawResult.stdout
      : "";
  const stderr =
    rawResult !== null && typeof rawResult === "object" && typeof rawResult.stderr === "string"
      ? rawResult.stderr
      : "";
  const normalizedResult = { status, stdout, stderr };

  Object.defineProperty(normalizedResult, "exitCode", {
    value: status,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return normalizedResult;
};

const runHookEntrypoint = (scriptPath, options = {}) => {
  const scriptName = resolveScriptName(scriptPath);
  const scriptModule = resolveScriptModule(scriptPath);
  const env = resolveRuntimeEnv(options);
  const requestedRuntimeCwd = resolveRequestedRuntimeCwd(options);
  const payload = resolvePayload(options);
  const payloadCwd = resolvePayloadCwd(payload);
  const isolatedProjectCwd = resolveIsolatedProjectCwd(env, requestedRuntimeCwd, payloadCwd);
  const resolvedPayload = resolvePayloadRuntimeValue(payload, payloadCwd, isolatedProjectCwd);
  const stdinText = resolveStdinText(options, resolvedPayload);
  const runtime = {
    cwd: requestedRuntimeCwd,
    env,
    homedir: resolveRuntimeHomedir(env),
    ...resolveExtraRuntime(options),
  };

  runtime.cwd = remapHooksRootCwd(runtime.cwd, isolatedProjectCwd);

  materializeRuntimeConfigs(runtime.cwd, resolvedPayload, env);

  const rawResult = runtimeOnlyScriptNames.has(scriptName)
    ? scriptModule.run(runtime)
    : scriptModule.run(stdinText, runtime);
  return normalizeHookResult(rawResult);
};

module.exports = {
  tempDirs,
  generatedEnvPaths,
  createTempDir,
  buildEnv,
  hasEnvVaultPath,
  remapHooksRootCwd,
  writeText,
  today,
  buildTranscript,
  cleanupGeneratedArtifacts,
  runHookEntrypoint,
};
