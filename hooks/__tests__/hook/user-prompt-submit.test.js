"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UTF8_ENCODING } = require("../../lib/shared/constants");
const {
  ENV_KEY_VAULT_PATH,
  ENV_KEY_SUBFOLDER,
  PROJECT_CONFIG_FILE_NAME,
  DOTENV_FILE_NAME,
  GLOBAL_MM_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
} = require("../../lib/config/constants");
const { buildDailyChunkPath, buildDailyFilePath } = require("../../lib/vault/vault");
const { resolveCaptureStatePath } = require("../../lib/capture/capture-state");
const userPromptSubmit = require("../../user-prompt-submit");
const { materializeProjectDotEnvConfig } = require("../helpers/project-dot-env");
const {
  TEST_VAULT_PREFIX,
  TEST_HOME_PREFIX,
  TEST_CWD_PREFIX,
  TEST_TRANSCRIPT_PREFIX,
  TEST_MM_HOME_PREFIX,
  TEST_MM_VAULT_PREFIX,
  TEST_MM_CWD_PREFIX,
  TEST_DEFAULT_TRANSCRIPT_FILE,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_HOOK_ENTRY_USER_PROMPT_SUBMIT: HOOK_ENTRY_USER_PROMPT_SUBMIT,
  TEST_HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
  TEST_ASSISTANT_REPLY_ENTRY_NAME: ASSISTANT_REPLY_ENTRY_NAME,
} = require("../helpers/test-constants");
const {
  generatedEnvPaths,
  createTempDir,
  buildEnv,
  writeText,
  today,
  buildTranscript,
  cleanupGeneratedArtifacts,
  runHookEntrypoint,
} = require("../helpers/entrypoint-runtime");
const hooksRoot = path.resolve(__dirname, "..", "..");
const ENTRYPOINT = "user-prompt-submit.js";
const EMPTY_CWD_PREFIX = "memory-mason-cwd-empty-";
const EMPTY_HOME_PREFIX = "memory-mason-home-empty-";
const TEST_TRANSCRIPT_TURN_COUNT_WITH_ASSISTANT = 4;

const _yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

afterEach(() => {
  cleanupGeneratedArtifacts();
});

describe("entrypoint config readers", () => {
  it("reads .env text for user-prompt-submit.js", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=/vault/path\n${ENV_KEY_SUBFOLDER}=notes`;

    writeText(path.join(cwd, DOTENV_FILE_NAME), envText);

    expect(userPromptSubmit.readDotEnvText(cwd)).toBe(envText);
    expect(userPromptSubmit.readDotEnvText(createTempDir(EMPTY_CWD_PREFIX))).toBe("");
  });

  it("reads global config text for user-prompt-submit.js", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const configText = JSON.stringify({ vaultPath: "/vault", subfolder: "notes" });

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, GLOBAL_CONFIG_FILE_NAME), configText);

    expect(userPromptSubmit.readGlobalConfigText(homeDir)).toBe(configText);
    expect(userPromptSubmit.readGlobalConfigText(createTempDir(EMPTY_HOME_PREFIX))).toBe("");
  });

  it("reads global .env text for user-prompt-submit.js", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=~/vault\n${ENV_KEY_SUBFOLDER}=global-brain`;

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, DOTENV_FILE_NAME), envText);

    expect(userPromptSubmit.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(userPromptSubmit.readGlobalDotEnvText(createTempDir(EMPTY_HOME_PREFIX))).toBe("");
  });
});

describe("user-prompt-submit.js", () => {
  it("writes prompt into daily log", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const hooksEnvPath = path.join(hooksRoot, DOTENV_FILE_NAME);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: " remember hooks ",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
    expect(result.status).toBe(0);
    expect(fs.existsSync(hooksEnvPath)).toBe(false);
    expect(fs.readFileSync(dailyPath, UTF8_ENCODING)).toContain("remember hooks");
  });

  it("writes rich slash-command metadata for Claude prompt expansion events", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: "UserPromptExpansion",
        cwd: hooksRoot,
        prompt: "/caveman analyze attachments",
        expansion_type: "slash_command",
        command_name: "caveman:caveman",
        command_args: "analyze attachments",
        command_source: "plugin",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
    const dailyContent = fs.readFileSync(dailyPath, UTF8_ENCODING);

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("UserPromptExpansion");
    expect(dailyContent).toContain("/caveman analyze attachments");
    expect(dailyContent).toContain("command: caveman:caveman");
    expect(dailyContent).toContain("source: plugin");
  });

  it("suppresses Memory Mason Claude prompt expansion when prompt field is empty", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: "UserPromptExpansion",
        cwd: hooksRoot,
        prompt: "",
        expansion_type: "skill",
        command_name: "memory-mason:mmc",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
    expect(state.mmSuppressed).toBe(true);
  });

  it("suppresses Memory Mason submit event when command_name is present and prompt field is empty", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
        cwd: hooksRoot,
        prompt: "",
        command_name: "memory-mason:mmc",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
    expect(state.mmSuppressed).toBe(true);
  });

  it("uses project .env over memory-mason.json when both exist", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath: "/ignored", subfolder: "my-brain" }),
    );

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: { hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB, cwd, prompt: "remember this" },
      cwd,
      env: buildEnv(homeDir, {
        [ENV_KEY_VAULT_PATH]: vaultPath,
        [ENV_KEY_SUBFOLDER]: "my-brain",
      }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "my-brain", today(), 1), UTF8_ENCODING),
    ).toContain("remember this");
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("skips when prompt text is empty", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: { hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB, cwd: hooksRoot },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("reports missing config when prompt exists but vault config does not", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "capture this",
      },
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });

  it("does not backfill assistant turns on prompt submit after transcript grows", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptDir = createTempDir(TEST_TRANSCRIPT_PREFIX);
    const transcriptPath = path.join(transcriptDir, TEST_DEFAULT_TRANSCRIPT_FILE);

    writeText(transcriptPath, buildTranscript(2));

    runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "first user prompt",
        transcript_path: transcriptPath,
        session_id: "session-anchor",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyPathAfterFirst = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
    const contentAfterFirst = fs.readFileSync(dailyPathAfterFirst, UTF8_ENCODING);
    expect(contentAfterFirst).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);
    expect(contentAfterFirst).toContain("first user prompt");

    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_WITH_ASSISTANT));

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "second user prompt",
        transcript_path: transcriptPath,
        session_id: "session-anchor",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(dailyPathAfterFirst, UTF8_ENCODING);

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("second user prompt");
    expect(dailyContent).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);
    expect(dailyContent).not.toContain("assistant turn 3");
  });

  it("skips assistant dump on first call even when transcript has historical turns", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptDir = createTempDir(TEST_TRANSCRIPT_PREFIX);
    const transcriptPath = path.join(transcriptDir, TEST_DEFAULT_TRANSCRIPT_FILE);

    writeText(transcriptPath, buildTranscript(10));

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "new prompt after long history",
        transcript_path: transcriptPath,
        session_id: "session-noorphan",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);
    expect(dailyContent).toContain("new prompt after long history");
  });

  it("keeps first and second prompts adjacent without inserting assistant backfill", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptDir = createTempDir(TEST_TRANSCRIPT_PREFIX);
    const transcriptPath = path.join(transcriptDir, TEST_DEFAULT_TRANSCRIPT_FILE);

    writeText(transcriptPath, buildTranscript(2));

    runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "second prompt",
        transcript_path: transcriptPath,
        session_id: "session-dedup",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_WITH_ASSISTANT));

    runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "third prompt",
        transcript_path: transcriptPath,
        session_id: "session-dedup",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
    const dailyContent = fs.readFileSync(dailyPath, UTF8_ENCODING);

    expect(dailyContent).toContain("second prompt");
    expect(dailyContent).toContain("third prompt");
    expect(dailyContent).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);
    expect(dailyContent).not.toContain("assistant turn 3");
  });

  it("skips assistant capture when transcript_path is absent", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "no transcript here",
        session_id: "session-xyz",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);
    expect(dailyContent).toContain("no transcript here");
  });

  it("skips assistant capture when session_id is absent", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptDir = createTempDir(TEST_TRANSCRIPT_PREFIX);
    const transcriptPath = path.join(transcriptDir, TEST_DEFAULT_TRANSCRIPT_FILE);

    writeText(transcriptPath, buildTranscript(2));

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "no session id",
        transcript_path: transcriptPath,
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);
  });

  it("skips assistant capture when transcript file does not exist", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "missing transcript file",
        transcript_path: path.join(hooksRoot, "does-not-exist.jsonl"),
        session_id: "session-missing",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain(ASSISTANT_REPLY_ENTRY_NAME);
  });
});

describe("run - mm command filtering", () => {
  const runWithPrompt = (prompt) => {
    const writerPath = require.resolve("../../lib/vault/writer");
    const userPromptSubmitPath = require.resolve("../../user-prompt-submit");

    delete require.cache[userPromptSubmitPath];
    delete require.cache[writerPath];

    const writer = require("../../lib/vault/writer");
    const appendToDailySpy = vi.spyOn(writer, "appendToDaily");
    const isolatedUserPromptSubmit = require("../../user-prompt-submit");

    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const projectCwd = createTempDir(TEST_MM_CWD_PREFIX);
    const env = buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath });
    const payload = JSON.stringify({
      hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
      cwd: projectCwd,
      prompt,
    });
    const buf = Buffer.from(payload);
    let rc = 0;

    const rawStdin = isolatedUserPromptSubmit.readStdin({
      readSync(_fd, chunk) {
        if (rc === 0) {
          rc++;
          buf.copy(chunk);
          return buf.length;
        }
        return 0;
      },
    });

    materializeProjectDotEnvConfig(projectCwd, env, generatedEnvPaths);

    const result = isolatedUserPromptSubmit.run(rawStdin, {
      cwd: projectCwd,
      env,
      homedir: homeDir,
    });

    return { result, appendToDailySpy };
  };

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[require.resolve("../../user-prompt-submit")];
    delete require.cache[require.resolve("../../lib/vault/writer")];
  });

  it("returns status 0 and skips vault write for /mmc prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mmc");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mmq prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mmq");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mml prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mml");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mms prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mms");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mma prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mma");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mmsetup prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mmsetup");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("does NOT skip for regular prompts starting with /m but not /mm", () => {
    const { result, appendToDailySpy } = runWithPrompt("/migrate notes");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT skip for prompts that contain /mmc but do not start with it", () => {
    const { result, appendToDailySpy } = runWithPrompt("please run /mmc later");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT skip for unknown /mm-style prompts", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mmwhatever now");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).toHaveBeenCalledTimes(1);
  });
});

describe("run - mm suppression state management", () => {
  it("sets mmSuppressed=true in capture state when /mm prompt is received", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "/mmc",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
    expect(state.mmSuppressed).toBe(true);
  });

  it("saves updated capture state when setting mmSuppressed", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    expect(fs.existsSync(statePath)).toBe(false);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "/mmq summarize",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(statePath)).toBe(true);
    expect(state.mmSuppressed).toBe(true);
  });

  it("sets mmSuppressed=true in capture state when /memory-mason command is received", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "/memory-mason:mmc",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
    expect(state.mmSuppressed).toBe(true);
  });

  it("clears mmSuppressed before processing non-/mm prompt", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

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

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "normal prompt after mm",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );
    const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("normal prompt after mm");
    expect(state.mmSuppressed).toBe(false);
  });
});

describe("run - sync flag", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const runWithSyncDisabled = (prompt) => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);

    vi.spyOn(userPromptSubmit, "resolveRuntimeConfig").mockReturnValue({
      vaultPath,
      subfolder: DEFAULT_SUBFOLDER,
      sync: false,
    });

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt,
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    return { result, statePath, dailyPath };
  };

  it("returns status 0 without writing to vault when sync is false", () => {
    const { result, dailyPath } = runWithSyncDisabled("normal sync-off prompt");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(dailyPath)).toBe(false);
  });

  it("does not write capture state when sync is false on /mm* prompt", () => {
    const { result, statePath, dailyPath } = runWithSyncDisabled("/mmc");

    expect(result.status).toBe(0);
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.existsSync(dailyPath)).toBe(false);
  });

  it("does not write capture state when sync is false on /memory-mason prompt", () => {
    const { result, statePath, dailyPath } = runWithSyncDisabled("/memory-mason:mmc");

    expect(result.status).toBe(0);
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.existsSync(dailyPath)).toBe(false);
  });

  it("does not write capture state when sync is false on normal prompt", () => {
    const { result, statePath, dailyPath } = runWithSyncDisabled("normal prompt with sync off");

    expect(result.status).toBe(0);
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.existsSync(dailyPath)).toBe(false);
  });
});

describe("user-prompt-submit.js readStdin", () => {
  it("returns valid JSON string from mocked fd 0", () => {
    const payload = JSON.stringify({
      hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
      prompt: "hello",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      userPromptSubmit.readStdin({
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
    expect(userPromptSubmit.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("user-prompt-submit.js main", () => {
  it("calls exit with status 0 after writing prompt", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const cwd = createTempDir(TEST_MM_CWD_PREFIX);
    const env = buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath });
    const payload = JSON.stringify({
      hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
      cwd,
      prompt: "main test",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = [];
    const errors = [];
    let exitCode = null;
    materializeProjectDotEnvConfig(cwd, env, generatedEnvPaths);
    userPromptSubmit.main({
      io: {
        stdout: (t) => writes.push(t),
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
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
      cwd,
      env,
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("writes stderr when config is missing", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const payload = JSON.stringify({
      hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
      cwd: createTempDir("mm-nocfg-"),
      prompt: "test",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = [];
    let exitCode = null;
    userPromptSubmit.main({
      io: {
        stdout: () => {},
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
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
      cwd: createTempDir("mm-fb-"),
      env: buildEnv(homeDir),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain(
      "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });

  it("falls back to process stdout/stderr when io functions are missing", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const env = buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath });
    const payload = JSON.stringify({
      hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
      cwd: homeDir,
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    materializeProjectDotEnvConfig(homeDir, env, generatedEnvPaths);
    const result = userPromptSubmit.main({
      io: { exit: () => {} },
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
      cwd: homeDir,
      env,
      homedir: homeDir,
    });
    expect(result.status).toBe(0);
  });
});

describe("user-prompt-submit.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = userPromptSubmit.run(
      JSON.stringify({ hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT, prompt: "test" }),
      { env: null, cwd: 123, homedir: 42 },
    );
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const env = buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath });
    const fallbackCwd = createTempDir("mm-fb-");
    materializeProjectDotEnvConfig(fallbackCwd, env, generatedEnvPaths);
    const result = userPromptSubmit.run(
      JSON.stringify({ hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT, prompt: "test" }),
      {
        env,
        cwd: fallbackCwd,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("run - coaching state branch coverage", () => {
  const captureStatePath = require.resolve("../../lib/capture/capture-state");
  const upsPath = require.resolve("../../user-prompt-submit");

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[captureStatePath];
    delete require.cache[upsPath];
  });

  it("skips coaching update when hash computation fails", () => {
    delete require.cache[captureStatePath];
    delete require.cache[upsPath];

    const freshCaptureState = require("../../lib/capture/capture-state");
    vi.spyOn(freshCaptureState, "hashCoachingPrompt").mockImplementation(() => {
      throw new Error("hash error");
    });

    const isolatedUPS = require("../../user-prompt-submit");

    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const env = buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath });

    const result = runHookEntrypoint(isolatedUPS, {
      payload: {
        hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
        cwd: hooksRoot,
        prompt: "valid prompt text",
        session_id: "session-hash-fail",
      },
      env,
    });

    expect(result.status).toBe(0);
  });

  it("emits coaching advisory after reaching nag threshold", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const { COACHING_NAG_THRESHOLD } = require("../../lib/capture/constants");
    const REPEATED_PROMPT = "fix the auth bug please";
    const SESSION = "session-coaching-nag";

    for (let i = 0; i < COACHING_NAG_THRESHOLD; i++) {
      runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
          cwd: hooksRoot,
          prompt: REPEATED_PROMPT,
          session_id: SESSION,
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });
    }

    const metaDir = path.join(vaultPath, DEFAULT_SUBFOLDER, "_raw", today(), "_meta");
    expect(fs.existsSync(metaDir)).toBe(true);
    expect(fs.readdirSync(metaDir).some((f) => f.endsWith(".md"))).toBe(true);
  });
});
