"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildDailyChunkPath } = require("../lib/vault");
const { buildCommandErrorResult, formatErrorMessage, writeIfPresent } = require("../lib/cli");
const { materializeProjectDotEnvConfig } = require("./helpers/project-dot-env");

const hooksRoot = path.resolve(__dirname, "..");
const _repoRoot = path.resolve(hooksRoot, "..");
let tempDirs = [];
const generatedEnvPaths = [];

const createTempDir = (prefix) => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs = tempDirs.concat(dirPath);
  return dirPath;
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

const buildEnv = (homeDir, overrides = {}) => ({
  ...process.env,
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

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const buildTranscript = (turnCount, firstUserContent = "user turn") =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % 2 === 0;
    const role = isUser ? "user" : "assistant";
    const content = isUser && index === 0 ? firstUserContent : `${role} turn ${index}`;
    return JSON.stringify({ message: { role, content } });
  }).join("\n");

const runCli = (scriptName, options = {}) => {
  const env = typeof options.env === "object" && options.env !== null ? options.env : process.env;
  const requestedCwd = typeof options.cwd === "string" ? options.cwd : hooksRoot;
  const inputText = typeof options.input === "string" ? options.input : "";
  const parsedInput = (() => {
    if (inputText === "") {
      return null;
    }

    try {
      const parsed = JSON.parse(inputText);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch (_error) {
      return null;
    }
  })();
  const inputCwd =
    parsedInput !== null && typeof parsedInput.cwd === "string" ? parsedInput.cwd : "";
  const isolatedProjectCwd =
    hasEnvVaultPath(env) && (requestedCwd === hooksRoot || inputCwd === hooksRoot)
      ? createTempDir("mm-cwd-")
      : "";
  const cwd = remapHooksRootCwd(requestedCwd, isolatedProjectCwd);
  const resolvedInputText =
    parsedInput !== null && inputCwd !== ""
      ? JSON.stringify({ ...parsedInput, cwd: remapHooksRootCwd(inputCwd, isolatedProjectCwd) })
      : inputText;

  materializeProjectDotEnvConfig(cwd, env, generatedEnvPaths);
  const resolvedInputCwd = remapHooksRootCwd(inputCwd, isolatedProjectCwd);
  if (resolvedInputCwd !== "" && resolvedInputCwd !== cwd) {
    materializeProjectDotEnvConfig(resolvedInputCwd, env, generatedEnvPaths);
  }

  return spawnSync(
    process.execPath,
    [path.join(hooksRoot, scriptName)].concat(options.args || []),
    {
      cwd,
      env,
      input: resolvedInputText,
      encoding: "utf-8",
    },
  );
};

afterEach(() => {
  tempDirs.forEach((dirPath) => {
    fs.rmSync(dirPath, { recursive: true, force: true });
  });
  tempDirs = [];
  while (generatedEnvPaths.length > 0) {
    fs.rmSync(generatedEnvPaths.pop(), { force: true });
  }
});

describe("lib/cli.js", () => {
  it("formats Error and non-Error values", () => {
    expect(formatErrorMessage(new Error("boom"))).toBe("boom");
    expect(formatErrorMessage("plain")).toBe("plain");
  });

  it("builds command error result with trailing newline", () => {
    expect(buildCommandErrorResult("plain")).toEqual({
      status: 0,
      stdout: "",
      stderr: "plain\n",
    });
  });

  it("writes only non-empty text", () => {
    const writes = [];
    writeIfPresent("", (text) => writes.push(text));
    writeIfPresent("ok", (text) => writes.push(text));
    expect(writes).toEqual(["ok"]);
  });
});

describe("CLI direct execution", () => {
  it("executes session-start.js directly", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = runCli("session-start.js", {
      input: JSON.stringify({ cwd: hooksRoot }),
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"hookEventName":"SessionStart"');
  });

  it("executes user-prompt-submit.js directly", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = runCli("user-prompt-submit.js", {
      input: JSON.stringify({
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "cli prompt",
      }),
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("cli prompt");
  });

  it("executes post-tool-use.js directly", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = runCli("post-tool-use.js", {
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        cwd: hooksRoot,
        tool_name: "Write",
        tool_response: "cli tool output",
      }),
      env: buildEnv(homeDir, {
        MEMORY_MASON_VAULT_PATH: vaultPath,
        MEMORY_MASON_CAPTURE_MODE: "full",
      }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("cli tool output");
  });

  it("executes pre-compact.js directly", () => {
    const result = runCli("pre-compact.js", {
      input: "{bad-json",
      env: buildEnv(createTempDir("mm-home-")),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin");
  });

  it("executes session-end.js directly", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(2));

    const result = runCli("session-end.js", {
      input: JSON.stringify({
        hook_event_name: "session_end",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "cli-session",
        source: "stop",
      }),
      env: buildEnv(homeDir, {
        MEMORY_MASON_VAULT_PATH: vaultPath,
        MEMORY_MASON_CAPTURE_MODE: "full",
      }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("cli-session / stop");
  });
});
