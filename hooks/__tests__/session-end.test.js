"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  UTF8_ENCODING,
  MAX_TAG_STRIP_COUNT,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
} = require("../lib/constants");
const {
  ENV_KEY_VAULT_PATH,
  ENV_KEY_SUBFOLDER,
  ENV_KEY_CAPTURE_MODE,
  ENV_KEY_INVOKED_BY,
  PROJECT_CONFIG_FILE_NAME,
  DOTENV_FILE_NAME,
  GLOBAL_MM_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
} = require("../lib/config-keys");
const {
  TEST_VAULT_PREFIX,
  TEST_HOME_PREFIX,
  TEST_CWD_PREFIX,
  TEST_TRANSCRIPT_PREFIX,
  TEST_MM_HOME_PREFIX,
  TEST_MM_VAULT_PREFIX,
  TEST_MM_CWD_PREFIX,
  TEST_MM_TR_PREFIX,
  TEST_DEFAULT_TRANSCRIPT_FILE,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_CAPTURE_MODE_LITE: CAPTURE_MODE_LITE,
  TEST_CAPTURE_MODE_FULL: CAPTURE_MODE_FULL,
  TEST_HOOK_ENTRY_USER_PROMPT_SUBMIT: HOOK_ENTRY_USER_PROMPT_SUBMIT,
  TEST_HOOK_EVENT_STOP: HOOK_EVENT_STOP,
  TEST_HOOK_EVENT_STOP_PASCAL: HOOK_EVENT_STOP_PASCAL,
  TEST_HOOK_EVENT_SESSION_END_SNAKE: HOOK_EVENT_SESSION_END_SNAKE,
  TEST_HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
  TEST_PLATFORM_CLAUDE_CODE: PLATFORM_CLAUDE_CODE,
  TEST_PLATFORM_COPILOT_CLI: PLATFORM_COPILOT_CLI,
  TEST_PLATFORM_CODEX: PLATFORM_CODEX,
  TEST_TRANSCRIPT_ROLE_USER: TRANSCRIPT_ROLE_USER,
  TEST_TRANSCRIPT_ROLE_ASSISTANT: TRANSCRIPT_ROLE_ASSISTANT,
  TEST_ASSISTANT_REPLY_ENTRY_NAME: ASSISTANT_REPLY_ENTRY_NAME,
  TEST_UNKNOWN_LABEL: UNKNOWN_LABEL,
} = require("./helpers/test-constants");
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
const sessionEnd = require("../session-end");
const { buildStopAssistantSelection } = require("../session-end");
const userPromptSubmit = require("../user-prompt-submit");
const { materializeProjectDotEnvConfig } = require("./helpers/project-dot-env");
const hooksRoot = path.resolve(__dirname, "..");

const TWO = 2;
const THREE = 3;
const FOUR = 4;
const FORTY = 40;
const LONG_TURN_LENGTH = 17000;
const ENTRYPOINT_FILE = "session-end.js";
const USER_PROMPT_SUBMIT_ENTRYPOINT_FILE = "user-prompt-submit.js";

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
  typeof env[ENV_KEY_VAULT_PATH] === "string" &&
  env[ENV_KEY_VAULT_PATH] !== "";

const remapHooksRootCwd = (targetCwd, isolatedProjectCwd) =>
  targetCwd === hooksRoot && isolatedProjectCwd !== "" ? isolatedProjectCwd : targetCwd;

const withProcessCaptureMode = (value, callback) => {
  const hadCaptureMode = Object.hasOwn(process.env, ENV_KEY_CAPTURE_MODE);
  const previousCaptureMode = process.env[ENV_KEY_CAPTURE_MODE];

  if (typeof value === "string") {
    process.env[ENV_KEY_CAPTURE_MODE] = value;
  } else {
    delete process.env[ENV_KEY_CAPTURE_MODE];
  }

  try {
    return callback();
  } finally {
    if (hadCaptureMode && typeof previousCaptureMode === "string") {
      process.env[ENV_KEY_CAPTURE_MODE] = previousCaptureMode;
    } else {
      delete process.env[ENV_KEY_CAPTURE_MODE];
    }
  }
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, UTF8_ENCODING);
};

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(TWO, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const _yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(TWO, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const buildTranscript = (turnCount, firstUserContent = "user turn") =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % TWO === 0;
    const role = isUser ? TRANSCRIPT_ROLE_USER : TRANSCRIPT_ROLE_ASSISTANT;
    const content = isUser && index === 0 ? firstUserContent : `${role} turn ${index}`;
    return JSON.stringify({ message: { role, content } });
  }).join("\n");

const buildVsCodeTranscript = (turns) => {
  const entries = [
    {
      type: "session.start",
      data: {
        sessionId: "session-1",
        version: 1,
        producer: "copilot-agent",
        copilotVersion: "0.0.0",
        vscodeVersion: "1.0.0",
        startTime: "2025-01-01T00:00:00.000Z",
        context: { cwd: hooksRoot },
      },
    },
  ].concat(
    turns.flatMap((turn, turnIndex) => {
      const userEntries = [
        {
          type: "user.message",
          data: { content: turn.user, attachments: [] },
        },
      ];

      if (typeof turn.assistant !== "string") {
        return userEntries;
      }

      return userEntries.concat([
        {
          type: "assistant.turn_start",
          data: { turnId: `${turnIndex}.0` },
        },
        {
          type: "assistant.message",
          data: { messageId: `message-${turnIndex}`, content: turn.assistant, toolRequests: [] },
        },
        {
          type: "assistant.turn_end",
          data: { turnId: `${turnIndex}.0` },
        },
      ]);
    }),
  );

  return entries
    .map((entry, index) =>
      JSON.stringify({
        ...entry,
        id: `entry-${index}`,
        timestamp: `2025-01-01T00:00:${String(index).padStart(TWO, "0")}.000Z`,
        parentId: index === 0 ? null : `entry-${index - 1}`,
      }),
    )
    .join("\n");
};

const runScript = (scriptName, options = {}) => {
  const env = options.env || process.env;
  const homedir = env.USERPROFILE && env.USERPROFILE !== "" ? env.USERPROFILE : os.homedir();
  const requestedRuntimeCwd = options.cwd || hooksRoot;
  const payload =
    typeof options.payload === "object" &&
    options.payload !== null &&
    !Array.isArray(options.payload)
      ? options.payload
      : null;
  const payloadCwd = payload !== null && typeof payload.cwd === "string" ? payload.cwd : "";
  const isolatedProjectCwd =
    hasEnvVaultPath(env) && (requestedRuntimeCwd === hooksRoot || payloadCwd === hooksRoot)
      ? createTempDir(TEST_MM_CWD_PREFIX)
      : "";
  const resolvedPayload =
    payload !== null && payloadCwd !== ""
      ? { ...payload, cwd: remapHooksRootCwd(payloadCwd, isolatedProjectCwd) }
      : payload;
  let stdinText = "";
  if (typeof options.stdinText === "string") {
    stdinText = options.stdinText;
  } else if (resolvedPayload !== null) {
    stdinText = JSON.stringify(resolvedPayload);
  }
  const runtime = {
    cwd: remapHooksRootCwd(requestedRuntimeCwd, isolatedProjectCwd),
    env,
    homedir,
    ...(options.runtime || {}),
  };
  materializeProjectDotEnvConfig(runtime.cwd, env, generatedEnvPaths);
  const resolvedPayloadCwd =
    resolvedPayload !== null && typeof resolvedPayload.cwd === "string" ? resolvedPayload.cwd : "";
  if (resolvedPayloadCwd !== "" && resolvedPayloadCwd !== runtime.cwd) {
    materializeProjectDotEnvConfig(resolvedPayloadCwd, env, generatedEnvPaths);
  }
  if (scriptName === USER_PROMPT_SUBMIT_ENTRYPOINT_FILE) {
    return userPromptSubmit.run(stdinText, runtime);
  }
  return sessionEnd.run(stdinText, runtime);
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }

  while (generatedEnvPaths.length > 0) {
    fs.rmSync(generatedEnvPaths.pop(), { force: true });
  }
});

describe("entrypoint config readers", () => {
  const scriptName = ENTRYPOINT_FILE;
  const scriptModule = sessionEnd;

  it(`reads .env text for ${scriptName}`, () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=/vault/path\n${ENV_KEY_SUBFOLDER}=notes`;

    writeText(path.join(cwd, DOTENV_FILE_NAME), envText);

    expect(scriptModule.readDotEnvText(cwd)).toBe(envText);
    expect(scriptModule.readDotEnvText(createTempDir(`${TEST_CWD_PREFIX}empty-`))).toBe("");
  });

  it(`reads global config text for ${scriptName}`, () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const configText = JSON.stringify({ vaultPath: "/vault", subfolder: "notes" });

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, GLOBAL_CONFIG_FILE_NAME), configText);

    expect(scriptModule.readGlobalConfigText(homeDir)).toBe(configText);
    expect(scriptModule.readGlobalConfigText(createTempDir(`${TEST_HOME_PREFIX}empty-`))).toBe("");
  });

  it(`reads global .env text for ${scriptName}`, () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=~/vault\n${ENV_KEY_SUBFOLDER}=global-brain`;

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, DOTENV_FILE_NAME), envText);

    expect(scriptModule.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(scriptModule.readGlobalDotEnvText(createTempDir(`${TEST_HOME_PREFIX}empty-`))).toBe("");
  });
});

describe("session-end.js", () => {
  it("skips when invoked by another Memory Mason command", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(2));

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
      },
      env: buildEnv(homeDir, {
        [ENV_KEY_VAULT_PATH]: vaultPath,
        [ENV_KEY_INVOKED_BY]: "mmq",
      }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("captures assistant replies on Stop and skips duplicates for unchanged transcript", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(1, "first prompt turn"));

    runScript(USER_PROMPT_SUBMIT_ENTRYPOINT_FILE, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
    const afterFirstPrompt = fs.readFileSync(dailyPath, UTF8_ENCODING);
    expect(afterFirstPrompt).toContain("first prompt");
    expect(afterFirstPrompt).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);

    writeText(transcriptPath, buildTranscript(2, "first prompt turn"));

    runScript(ENTRYPOINT_FILE, {
      payload: {
        hookEventName: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const afterFirstStop = fs.readFileSync(dailyPath, UTF8_ENCODING);
    expect(afterFirstStop).toContain(ASSISTANT_REPLY_ENTRY_NAME);
    expect(afterFirstStop).toContain("assistant turn 1");
    expect(afterFirstStop.indexOf("first prompt")).toBeLessThan(
      afterFirstStop.indexOf("assistant turn 1"),
    );

    writeText(transcriptPath, buildTranscript(THREE, "first prompt turn"));

    runScript(USER_PROMPT_SUBMIT_ENTRYPOINT_FILE, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "second prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const afterSecondPrompt = fs.readFileSync(dailyPath, UTF8_ENCODING);
    expect(afterSecondPrompt).toContain("second prompt");
    expect(afterSecondPrompt.split("assistant turn 1").length - 1).toBe(1);
    expect(afterSecondPrompt).not.toContain("assistant turn 3");

    writeText(transcriptPath, buildTranscript(FOUR, "first prompt turn"));

    runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const afterSecondStop = fs.readFileSync(dailyPath, UTF8_ENCODING);
    expect(afterSecondStop).toContain("assistant turn 3");
    expect(afterSecondStop.indexOf("second prompt")).toBeLessThan(
      afterSecondStop.indexOf("assistant turn 3"),
    );

    runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const afterDuplicateStop = fs.readFileSync(dailyPath, UTF8_ENCODING);
    expect(afterDuplicateStop).toBe(afterSecondStop);
    expect(afterDuplicateStop.split("assistant turn 3").length - 1).toBe(1);
  });

  it("captures first assistant reply on Stop when prompt submit could not anchor transcript count", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    runScript(USER_PROMPT_SUBMIT_ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-first-turn",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    writeText(transcriptPath, buildTranscript(2, "first prompt turn"));

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-first-turn",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("first prompt");
    expect(dailyContent).toContain("assistant turn 1");
    expect(dailyContent.indexOf("first prompt")).toBeLessThan(
      dailyContent.indexOf("assistant turn 1"),
    );
  });

  it("uses last_assistant_message fallback on Stop without replaying duplicate assistant replies later", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(1, "first prompt turn"));

    runScript(USER_PROMPT_SUBMIT_ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-payload-fallback",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-payload-fallback",
        last_assistant_message: "assistant turn 1",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    writeText(transcriptPath, buildTranscript(2, "first prompt turn"));

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-payload-fallback",
        last_assistant_message: "assistant turn 1",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent.split("assistant turn 1").length - 1).toBe(1);
  });

  it("is a no-op on first Stop when transcript is empty and payload has no assistant message", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, "");

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-empty-first",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("stop path preserves <thinking> in transcript-derived assistant content in lite", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      transcriptPath,
      [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "answer<thinking>hidden</thinking>",
          },
        }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-lite-thinking-transcript",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("answer");
    expect(dailyContent).toContain("<thinking>hidden</thinking>");
  });

  it("stop path preserves <thinking> in last_assistant_message fallback in lite", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, "");

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-lite-thinking-fallback",
        last_assistant_message: "answer<thinking>hidden</thinking>",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("answer");
    expect(dailyContent).toContain("<thinking>hidden</thinking>");
  });

  it("stop path full mode preserves tags", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify(
        { vaultPath, subfolder: DEFAULT_SUBFOLDER, captureMode: CAPTURE_MODE_FULL },
        null,
        2,
      ),
    );
    writeText(
      transcriptPath,
      [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "answer<thinking>hidden</thinking>",
          },
        }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-stop-full-thinking",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("<thinking>hidden</thinking>");
  });

  it("Stop path in lite mode captures only last assistant turn from multi-intermediate batch", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      transcriptPath,
      [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "thinking..." } }),
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "intermediate step" },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "final answer" } }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-lite-multi-assistant",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("final answer");
    expect(dailyContent).not.toContain("thinking...");
    expect(dailyContent).not.toContain("intermediate step");
    expect(dailyContent.split(ASSISTANT_REPLY_ENTRY_NAME).length - 1).toBe(1);
  });

  it("strips memory tags from Stop assistant turn before writing", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      transcriptPath,
      [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "visible <system-reminder>tag content</system-reminder> reply",
          },
        }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-strip-tags",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("visible");
    expect(dailyContent).toContain("reply");
    expect(dailyContent).not.toContain("<system-reminder>");
    expect(dailyContent).not.toContain("tag content");
  });

  it("skips Stop assistant turn when stripping leaves empty content", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const sessionId = "session-stop-strip-empty";

    writeText(
      transcriptPath,
      [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "<system-reminder>tag content</system-reminder>",
          },
        }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: sessionId,
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
    expect(state.transcriptTurnCounts[sessionId]).toBe(TWO);
  });

  it("skips sensitive Stop assistant turn and returns sensitive warning", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const sessionId = "session-stop-sensitive-skip";

    writeText(
      transcriptPath,
      [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "path includes .env secrets",
          },
        }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: sessionId,
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(HOOK_WARNING_SENSITIVE_SKIP_PREFIX);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
    expect(state.transcriptTurnCounts[sessionId]).toBe(TWO);
  });

  it("session_end path lite skips entirely", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      transcriptPath,
      [
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_USER, content: "u1<thinking>hidden</thinking>" },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" } }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-end-lite-strip",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("session_end path full mode preserves tags", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify(
        { vaultPath, subfolder: DEFAULT_SUBFOLDER, captureMode: CAPTURE_MODE_FULL },
        null,
        2,
      ),
    );
    writeText(
      transcriptPath,
      [
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_USER, content: "u1<thinking>hidden</thinking>" },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" } }),
      ].join("\n"),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-end-full-preserve",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("<thinking>hidden</thinking>");
  });

  it("captures assistant reply from VS Code transcript entries on Stop", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildVsCodeTranscript([{ user: "first prompt" }]));

    runScript(USER_PROMPT_SUBMIT_ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-vscode-transcript",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    writeText(
      transcriptPath,
      buildVsCodeTranscript([{ user: "first prompt", assistant: "assistant turn 1" }]),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-vscode-transcript",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("first prompt");
    expect(dailyContent).toContain("assistant turn 1");
  });

  it("writes transcript from explicit transcript path", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, buildTranscript(2));

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-1",
          source: HOOK_EVENT_STOP,
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
      expect(result.status).toBe(0);
      expect(fs.readFileSync(dailyPath, UTF8_ENCODING)).toContain("session-1 / stop");
    });
  });

  it("session_end path full mode skips when transcript is empty", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, "");

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-end-full-empty",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
    });
  });

  it("session_end path full mode skips when all turns are filtered out as mm turns", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(
        transcriptPath,
        [
          JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "/mmc" } }),
          JSON.stringify({
            message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "compiled knowledge" },
          }),
        ].join("\n"),
      );

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-end-full-all-mm",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
    });
  });

  it("writes full transcript from explicit path without truncation", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const longFirstTurn = `session-end-first-user-${"y".repeat(LONG_TURN_LENGTH)}`;

      writeText(transcriptPath, buildTranscript(FORTY, longFirstTurn));

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-session-end",
          source: HOOK_EVENT_STOP,
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
      const dailyContent = fs.readFileSync(dailyPath, UTF8_ENCODING);

      expect(result.status).toBe(0);
      expect(dailyContent).toContain(longFirstTurn);
      expect(dailyContent).toContain("assistant turn 39");
      expect(dailyContent).not.toContain("...(truncated)");
    });
  });

  it("falls back to codex session files when transcript path missing", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const codexFile = path.join(
        homeDir,
        ".codex",
        "sessions",
        "session-2",
        "session-2-log.jsonl",
      );

      writeText(codexFile, buildTranscript(2));

      runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          turn_id: "turn-1",
          cwd: hooksRoot,
          session_id: "session-2",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain(`session-2 / ${PLATFORM_CODEX}`);
    });
  });

  it("falls back to Copilot CLI session-state content", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const sessionDir = path.join(homeDir, ".copilot", "session-state", "session-a");
      const cwd = createTempDir(TEST_CWD_PREFIX);
      const transcriptPath = path.join(sessionDir, "state.jsonl");

      writeText(transcriptPath, buildTranscript(2, cwd));

      runScript(ENTRYPOINT_FILE, {
        payload: {
          timestamp: "2026-04-27T10:00:00.000Z",
          cwd,
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain(`${UNKNOWN_LABEL} / ${PLATFORM_COPILOT_CLI}`);
    });
  });

  it("skips when Copilot CLI session-state is missing", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        timestamp: "2026-04-27T10:00:00.000Z",
        cwd: hooksRoot,
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("skips duplicate transcript capture within duplicate window", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, buildTranscript(2));

      runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-3",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
      const firstContent = fs.readFileSync(dailyPath, UTF8_ENCODING);

      runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-3",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(fs.readFileSync(dailyPath, UTF8_ENCODING)).toBe(firstContent);
    });
  });

  it("reports invalid stdin to stderr", () => {
    const result = runScript(ENTRYPOINT_FILE, {
      stdinText: "{bad",
      env: buildEnv(createTempDir(TEST_HOME_PREFIX)),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin: {bad");
  });
});

describe("buildStopAssistantSelection", () => {
  const makeTurn = (role, content) => ({ role, content });

  it("full mode returns all assistant turns from batch", () => {
    const turns = [
      makeTurn("user", "q1"),
      makeTurn("assistant", "intermediate 1"),
      makeTurn("assistant", "intermediate 2"),
      makeTurn("assistant", "final"),
    ];
    const { selectedTurns, shouldAppendPayloadAssistant } = buildStopAssistantSelection(
      turns,
      1,
      "",
      CAPTURE_MODE_FULL,
    );
    expect(selectedTurns).toEqual(["intermediate 1", "intermediate 2", "final"]);
    expect(shouldAppendPayloadAssistant).toBe(false);
  });

  it("lite mode returns only last assistant turn from batch", () => {
    const turns = [
      makeTurn("user", "q1"),
      makeTurn("assistant", "intermediate 1"),
      makeTurn("assistant", "intermediate 2"),
      makeTurn("assistant", "final"),
    ];
    const { selectedTurns, shouldAppendPayloadAssistant } = buildStopAssistantSelection(
      turns,
      0,
      "",
      CAPTURE_MODE_LITE,
    );
    expect(selectedTurns).toEqual(["final"]);
    expect(shouldAppendPayloadAssistant).toBe(false);
  });

  it("lite mode prefers payload assistant message over batch when should append", () => {
    const turns = [makeTurn("user", "q1"), makeTurn("assistant", "transcript turn")];
    const { selectedTurns, shouldAppendPayloadAssistant } = buildStopAssistantSelection(
      turns,
      0,
      "payload answer",
      CAPTURE_MODE_LITE,
    );
    expect(selectedTurns).toEqual(["payload answer"]);
    expect(shouldAppendPayloadAssistant).toBe(true);
  });

  it("lite mode returns empty when no turns and no payload", () => {
    const { selectedTurns, shouldAppendPayloadAssistant } = buildStopAssistantSelection(
      [],
      0,
      "",
      CAPTURE_MODE_LITE,
    );
    expect(selectedTurns).toEqual([]);
    expect(shouldAppendPayloadAssistant).toBe(false);
  });

  it("full mode appends payload when it differs from transcript tail", () => {
    const turns = [makeTurn("user", "q1"), makeTurn("assistant", "transcript turn")];
    const { selectedTurns, shouldAppendPayloadAssistant } = buildStopAssistantSelection(
      turns,
      0,
      "payload answer",
      CAPTURE_MODE_FULL,
    );
    expect(selectedTurns).toEqual(["transcript turn", "payload answer"]);
    expect(shouldAppendPayloadAssistant).toBe(true);
  });
});

describe("run - mm suppression for Stop event", () => {
  it("skips writing assistant reply when mmSuppressed is true", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    writeText(transcriptPath, buildTranscript(2, "stop-mm-user"));
    writeText(
      statePath,
      JSON.stringify(
        {
          lastCapture: null,
          mmSuppressed: true,
        },
        null,
        2,
      ),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-mm-true",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("writes assistant reply when mmSuppressed is false", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    writeText(transcriptPath, buildTranscript(2, "stop-mm-user"));
    writeText(
      statePath,
      JSON.stringify(
        {
          lastCapture: null,
          mmSuppressed: false,
        },
        null,
        2,
      ),
    );

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-mm-false",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("assistant turn 1");
  });
});

describe("run - sync flag", () => {
  it("returns status 0 without vault write for Stop event when sync is false", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const initialState = {
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: {
        "session-stop-sync-false": 1,
      },
    };

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER, sync: false }),
    );
    writeText(transcriptPath, buildTranscript(2, "session-sync-user"));
    writeText(statePath, JSON.stringify(initialState, null, 2));

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-stop-sync-false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const persistedState = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
    expect(persistedState).toEqual(initialState);
  });

  it("returns status 0 without vault write for SessionEnd event when sync is false", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const initialState = {
      lastCapture: {
        sessionId: "previous-session-sync",
        source: PLATFORM_CLAUDE_CODE,
        contentHash: "fedcba9876543210",
        timestampMs: 1,
      },
      mmSuppressed: false,
    };

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER, sync: false }),
    );
    writeText(transcriptPath, buildTranscript(2, "session-sync-user"));
    writeText(statePath, JSON.stringify(initialState, null, 2));

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-end-sync-false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const persistedState = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
    expect(persistedState).toEqual(initialState);
  });
});

describe("run - mm transcript filtering for SessionEnd event", () => {
  it("filters out /mm turns from full transcript before writing", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const mixedTranscript = [
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_USER, content: "/mmq summarize history" },
        }),
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "hidden mm assistant" },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "normal prompt" } }),
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "normal assistant" },
        }),
      ].join("\n");

      writeText(transcriptPath, mixedTranscript);

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-filter-mixed",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("normal prompt");
      expect(dailyContent).toContain("normal assistant");
      expect(dailyContent).not.toContain("/mmq summarize history");
      expect(dailyContent).not.toContain("hidden mm assistant");
    });
  });

  it("writes full transcript when no /mm turns are present", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, buildTranscript(FOUR, "normal first user turn"));

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-filter-none",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("normal first user turn");
      expect(dailyContent).toContain("assistant turn 3");
    });
  });

  it("skips writing full transcript when all turns are /mm commands", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const mmOnlyTranscript = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "/mmc" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "compiled" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "/mml" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "linted" } }),
    ].join("\n");

    writeText(transcriptPath, mmOnlyTranscript);

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-filter-all-mm",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("strips memory tags in full transcript mode before writing", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const transcript = [
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_USER,
            content: "hello<system-reminder>tag content</system-reminder>",
          },
        }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "answer<private>secret</private>",
          },
        }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-strip-tags",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("hello");
      expect(dailyContent).toContain("answer");
      expect(dailyContent).not.toContain("<system-reminder>");
      expect(dailyContent).not.toContain("<private>");
      expect(dailyContent).not.toContain("tag content");
      expect(dailyContent).not.toContain("secret");
    });
  });

  it("preserves user wording while compressing assistant transcript turns", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const transcript = [
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_USER,
            content: "just run tests",
          },
        }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "I will just run tests really quickly",
          },
        }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-preserve-user-wording",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("**User:** just run tests");
      expect(dailyContent).toContain("**Assistant:** I will run tests quickly");
      expect(dailyContent).not.toContain("**User:** run tests");
      expect(dailyContent).not.toContain("**Assistant:** I will just run tests really quickly");
    });
  });

  it("skips full transcript write and state save when sensitive content is detected", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const transcript = [
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_USER,
            content: "please open .env and read settings",
          },
        }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "cannot share that",
          },
        }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-sensitive-skip",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_SENSITIVE_SKIP_PREFIX);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
      expect(fs.existsSync(resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER))).toBe(false);
    });
  });

  it("skips full transcript write when all turn content is stripped to empty", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const transcript = [
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_USER,
            content: "<system-reminder>remove-user</system-reminder>",
          },
        }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "<private>remove-assistant</private>",
          },
        }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-all-stripped",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
      expect(fs.existsSync(resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER))).toBe(false);
    });
  });

  it("returns tag warning in full transcript mode when tag count exceeds max", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const repeatedTag = "<system-reminder>x</system-reminder>";
      const heavyContent = `visible-${repeatedTag.repeat(MAX_TAG_STRIP_COUNT + 1)}`;
      const transcript = [
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_USER,
            content: heavyContent,
          },
        }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "assistant response",
          },
        }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runScript(ENTRYPOINT_FILE, {
        payload: {
          hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-tag-warning",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_TAG_LIMIT_PREFIX);
      expect(dailyContent).toContain("visible-");
      expect(dailyContent).toContain("assistant response");
      expect(dailyContent).not.toContain("<system-reminder>");
    });
  });
});

describe("session-end.js readStdin", () => {
  it("reads single chunk from mocked fd 0", () => {
    const payload = JSON.stringify({ hook_event_name: HOOK_EVENT_STOP_PASCAL });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      sessionEnd.readStdin({
        readSync(_fd, chunk) {
          if (rc === 0) {
            rc++;
            buf.copy(chunk);
            return buf.length;
          }
          return 0;
        },
      }),
    ).toBe(payload);
  });

  it("returns empty string on immediate EOF", () => {
    expect(sessionEnd.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("session-end.js firstNonEmptyString", () => {
  it("throws when values is not an array", () => {
    expect(() => sessionEnd.firstNonEmptyString("x")).toThrow("values must be an array");
    expect(() => sessionEnd.firstNonEmptyString(null)).toThrow("values must be an array");
  });
});

describe("session-end.js utility functions", () => {
  it("listFilesRecursive returns empty array for nonexistent path", () => {
    expect(sessionEnd.listFilesRecursive(path.join(createTempDir("mm-m-"), "no"))).toEqual([]);
  });

  it("findCodexSessionContent returns empty for dir with no json/jsonl files", () => {
    const dir = createTempDir("mm-codex-");
    writeText(path.join(dir, "readme.txt"), "not json");
    expect(sessionEnd.findCodexSessionContent(dir, "session-1")).toBe("");
  });

  it("findCodexSessionContent returns content when session id is empty", () => {
    const dir = createTempDir("mm-codex-");
    writeText(path.join(dir, "other.jsonl"), buildTranscript(2));
    expect(sessionEnd.findCodexSessionContent(dir, "")).not.toBe("");
  });

  it("findCodexSessionContent falls back to all files when session id does not match", () => {
    const dir = createTempDir("mm-codex-");
    writeText(path.join(dir, "other.jsonl"), buildTranscript(2));
    expect(sessionEnd.findCodexSessionContent(dir, "nonexistent-session")).not.toBe("");
  });

  it("findCodexSessionContent returns empty for nonexistent dir", () => {
    expect(sessionEnd.findCodexSessionContent(path.join(createTempDir("mm-m-"), "no"), "s1")).toBe(
      "",
    );
  });

  it("findCopilotCliSessionContent throws on missing session-state dir", () => {
    expect(() =>
      sessionEnd.findCopilotCliSessionContent(path.join(createTempDir("mm-m-"), "no"), ""),
    ).toThrow("copilot session-state dir not found");
  });

  it("findCopilotCliSessionContent throws when dirs exist but contain no .jsonl files", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-a");
    writeText(path.join(subDir, "readme.txt"), "not a jsonl");
    expect(() => sessionEnd.findCopilotCliSessionContent(sessionStateDir, "")).toThrow(
      "no .jsonl files found in copilot session-state",
    );
  });

  it("findCopilotCliSessionContentOrEmpty returns empty on missing dir", () => {
    expect(
      sessionEnd.findCopilotCliSessionContentOrEmpty(path.join(createTempDir("mm-m-"), "no"), ""),
    ).toBe("");
  });

  it("findCopilotCliSessionContent throws when jsonl files exist but are empty", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-b");
    writeText(path.join(subDir, TEST_DEFAULT_TRANSCRIPT_FILE), "");
    expect(() => sessionEnd.findCopilotCliSessionContent(sessionStateDir, "")).toThrow(
      "no transcript content found in copilot session-state",
    );
  });

  it("findCopilotCliSessionContent falls back to first dir when targetCwd not found in any jsonl", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-fb");
    writeText(path.join(subDir, "data.jsonl"), "some real content here");
    const result = sessionEnd.findCopilotCliSessionContent(sessionStateDir, "/nonexistent/path");
    expect(result).toBe("some real content here");
  });

  it("collectAssistantTurnContents filters and collects from start index", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "hi" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "hello" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "bye" },
    ];
    expect(sessionEnd.collectAssistantTurnContents(turns, 0)).toEqual(["hello", "bye"]);
    expect(sessionEnd.collectAssistantTurnContents(turns, 2)).toEqual(["bye"]);
  });

  it("collectAssistantTurnContents skips null and empty entries", () => {
    expect(
      sessionEnd.collectAssistantTurnContents(
        [
          null,
          { role: TRANSCRIPT_ROLE_ASSISTANT, content: "" },
          { role: TRANSCRIPT_ROLE_ASSISTANT, content: "ok" },
        ],
        0,
      ),
    ).toEqual(["ok"]);
  });

  it("getLastAssistantTurnContent returns last assistant or empty", () => {
    expect(
      sessionEnd.getLastAssistantTurnContent([
        { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a" },
        { role: TRANSCRIPT_ROLE_ASSISTANT, content: "b" },
      ]),
    ).toBe("b");
    expect(sessionEnd.getLastAssistantTurnContent([])).toBe("");
  });
});

describe("session-end.js stop with empty session ID", () => {
  it("returns early", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const projectCwd = createTempDir(TEST_MM_CWD_PREFIX);
    const env = buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath });
    materializeProjectDotEnvConfig(projectCwd, env, generatedEnvPaths);
    const result = sessionEnd.run(
      JSON.stringify({
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: projectCwd,
        transcript_path: path.join(createTempDir(TEST_MM_TR_PREFIX), "x.jsonl"),
      }),
      {
        cwd: projectCwd,
        env,
        homedir: homeDir,
      },
    );
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});

describe("session-end.js transcript with 0 turns on non-stop event", () => {
  it("skips when transcript has no user/assistant turns", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_MM_TR_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    writeText(transcriptPath, JSON.stringify({ message: { role: "system", content: "sys" } }));
    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-zero",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });
    expect(result.status).toBe(0);
  });

  it("increments transcript turn count from payload assistant when transcript is empty", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_MM_TR_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const sessionId = "session-stop-empty-payload";

    writeText(transcriptPath, "");

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_STOP_PASCAL,
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: sessionId,
        last_assistant_message: "assistant from payload",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(state.transcriptTurnCounts[sessionId]).toBe(2);
  });
});

describe("session-end.js readConfigText with existing file", () => {
  it("uses memory-mason.json when no env vault path is set", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const cwd = createTempDir(TEST_MM_CWD_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_MM_TR_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER, captureMode: CAPTURE_MODE_FULL }),
    );
    writeText(transcriptPath, buildTranscript(2));

    const result = runScript(ENTRYPOINT_FILE, {
      payload: {
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd,
        transcript_path: transcriptPath,
        session_id: "cfg-test",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1), UTF8_ENCODING),
    ).toContain("cfg-test /");
  });
});

describe("session-end.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = sessionEnd.run(
      JSON.stringify({
        hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
        cwd: createTempDir(TEST_MM_CWD_PREFIX),
      }),
      { env: null, cwd: 123, homedir: 42 },
    );
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const result = sessionEnd.run(
      JSON.stringify({ hook_event_name: HOOK_EVENT_SESSION_END_SNAKE }),
      {
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
        cwd: createTempDir("mm-fb-"),
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("session-end.js main", () => {
  it("reads stdin via mock fs and calls exit", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_MM_TR_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    writeText(transcriptPath, buildTranscript(2));
    const payload = JSON.stringify({
      hook_event_name: HOOK_EVENT_SESSION_END_SNAKE,
      cwd: hooksRoot,
      transcript_path: transcriptPath,
      session_id: "se-main",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = [];
    let exitCode = null;
    sessionEnd.main({
      fs: {
        readSync(_fd, chunk) {
          if (rc === 0) {
            rc++;
            buf.copy(chunk);
            return buf.length;
          }
          return 0;
        },
      },
      cwd: hooksRoot,
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      homedir: homeDir,
      io: {
        stdout: () => {},
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
    });
    expect(exitCode).toBe(0);
  });

  it("writes stderr on error", () => {
    const buf = Buffer.from("{bad");
    let rc = 0;
    const errors = [];
    let exitCode = null;
    sessionEnd.main({
      fs: {
        readSync(_fd, chunk) {
          if (rc === 0) {
            rc++;
            buf.copy(chunk);
            return buf.length;
          }
          return 0;
        },
      },
      cwd: hooksRoot,
      env: buildEnv(createTempDir("mm-h-")),
      io: {
        stdout: () => {},
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain("invalid JSON in stdin");
  });
});
