"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { UTF8_ENCODING } = require("../lib/shared/constants");
const { ENV_KEY_VAULT_PATH, ENV_KEY_CAPTURE_MODE } = require("../lib/config/constants");
const { buildDailyChunkPath } = require("../lib/vault/vault");
const { buildCommandErrorResult, formatErrorMessage, writeIfPresent } = require("../lib/cli/cli");
const { materializeProjectDotEnvConfig } = require("./helpers/project-dot-env");
const {
  TEST_MM_CWD_PREFIX,
  TEST_MM_HOME_PREFIX,
  TEST_MM_VAULT_PREFIX,
  TEST_MM_TR_PREFIX,
  TEST_DEFAULT_TRANSCRIPT_FILE,
  TEST_CAPTURE_MODE_FULL: CAPTURE_MODE_FULL,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_HOOK_ENTRY_POST_TOOL_USE: HOOK_ENTRY_POST_TOOL_USE,
  TEST_HOOK_EVENT_SESSION_END_SNAKE: HOOK_EVENT_SESSION_END_SNAKE,
  TEST_HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
  TEST_TRANSCRIPT_ROLE_USER: TRANSCRIPT_ROLE_USER,
  TEST_TRANSCRIPT_ROLE_ASSISTANT: TRANSCRIPT_ROLE_ASSISTANT,
} = require("./helpers/test-constants");

const hooksRoot = path.resolve(__dirname, "..");
const _repoRoot = path.resolve(hooksRoot, "..");
const SESSION_START_ENTRYPOINT = "session-start.js";
const USER_PROMPT_SUBMIT_ENTRYPOINT = "user-prompt-submit.js";
const POST_TOOL_USE_ENTRYPOINT = "post-tool-use.js";
const PRE_COMPACT_ENTRYPOINT = "pre-compact.js";
const SESSION_END_ENTRYPOINT = "session-end.js";
let tempDirs = [];
const generatedEnvPaths = [];

const createTempDir = (prefix) => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs = tempDirs.concat(dirPath);
  return dirPath;
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, UTF8_ENCODING);
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
  typeof env[ENV_KEY_VAULT_PATH] === "string" &&
  env[ENV_KEY_VAULT_PATH] !== "";

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
    const role = isUser ? TRANSCRIPT_ROLE_USER : TRANSCRIPT_ROLE_ASSISTANT;
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
      ? createTempDir(TEST_MM_CWD_PREFIX)
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
      encoding: UTF8_ENCODING,
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
  const expectCliWritesDailyChunk = (
    scriptName,
    inputPayload,
    expectedContent,
    envOverrides = {},
  ) => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const result = runCli(scriptName, {
      input: JSON.stringify(inputPayload),
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath, ...envOverrides }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1), UTF8_ENCODING),
    ).toContain(expectedContent);

    return { homeDir, vaultPath, result };
  };

  it("executes session-start.js directly", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const result = runCli(SESSION_START_ENTRYPOINT, {
      input: JSON.stringify({ cwd: hooksRoot }),
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"hookEventName":"SessionStart"');
  });

  it("executes user-prompt-submit.js directly", () => {
    expectCliWritesDailyChunk(
      USER_PROMPT_SUBMIT_ENTRYPOINT,
      {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "cli prompt",
      },
      "cli prompt",
    );
  });

  it("executes post-tool-use.js directly with low-signal output skipped", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const result = runCli(POST_TOOL_USE_ENTRYPOINT, {
      input: JSON.stringify({
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: hooksRoot,
        tool_name: "Write",
        tool_response: "cli tool output",
      }),
      env: buildEnv(homeDir, {
        [ENV_KEY_VAULT_PATH]: vaultPath,
        [ENV_KEY_CAPTURE_MODE]: CAPTURE_MODE_FULL,
      }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("executes pre-compact.js directly", () => {
    const result = runCli(PRE_COMPACT_ENTRYPOINT, {
      input: "{bad-json",
      env: buildEnv(createTempDir(TEST_MM_HOME_PREFIX)),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin");
  });

  it("executes session-end.js directly", () => {
    const transcriptPath = path.join(
      createTempDir(TEST_MM_TR_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(2));

    expectCliWritesDailyChunk(
      SESSION_END_ENTRYPOINT,
      {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "cli-session",
        source: "stop",
      },
      "cli-session / stop",
      {
        [ENV_KEY_CAPTURE_MODE]: CAPTURE_MODE_FULL,
      },
    );
  });
});

