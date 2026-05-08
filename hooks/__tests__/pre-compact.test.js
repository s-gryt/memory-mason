"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_TAG_STRIP_COUNT,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
} = require("../lib/filter/constants");
const { UTF8_ENCODING } = require("../lib/shared/constants");
const {
  ENV_KEY_VAULT_PATH,
  ENV_KEY_SUBFOLDER,
  ENV_KEY_CAPTURE_MODE,
  ENV_KEY_INVOKED_BY,
  PROJECT_CONFIG_FILE_NAME,
  DOTENV_FILE_NAME,
  GLOBAL_MM_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
} = require("../lib/config/constants");
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault/vault");
const { resolveCaptureStatePath, buildCaptureRecord } = require("../lib/capture/capture-state");
const { parseJsonlTranscript, renderTurnsAsMarkdown } = require("../lib/capture/transcript");
const { stripMemoryTags } = require("../lib/filter/tag-stripper");
const { compressNarrativeText } = require("../lib/economics/compress");
const { stripVTControlCharacters } = require("node:util");
const preCompact = require("../pre-compact");
const { materializeProjectDotEnvConfig } = require("./helpers/project-dot-env");
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
  TEST_CAPTURE_MODE_FULL: CAPTURE_MODE_FULL,
  TEST_HOOK_EVENT_PRE_COMPACT_KEBAB: HOOK_EVENT_PRE_COMPACT_KEBAB,
  TEST_TRANSCRIPT_ROLE_USER: TRANSCRIPT_ROLE_USER,
  TEST_TRANSCRIPT_ROLE_ASSISTANT: TRANSCRIPT_ROLE_ASSISTANT,
} = require("./helpers/test-constants");
const {
  generatedEnvPaths,
  createTempDir,
  buildEnv,
  writeText,
  today,
  buildTranscript,
  cleanupGeneratedArtifacts,
  runHookEntrypoint,
} = require("./helpers/entrypoint-runtime");
const hooksRoot = path.resolve(__dirname, "..");
const ENTRYPOINT = "pre-compact.js";
const EMPTY_CWD_PREFIX = "memory-mason-cwd-empty-";
const EMPTY_HOME_PREFIX = "memory-mason-home-empty-";
const TEST_TRANSCRIPT_TURN_COUNT_SHORT = 4;
const TEST_TRANSCRIPT_TURN_COUNT_STANDARD = 6;
const TEST_TRANSCRIPT_TURN_COUNT_EXTENDED = 40;
const TEST_LONG_FIRST_TURN_REPEAT_COUNT = 17000;
const TEST_INVALID_NON_ARRAY_INPUT = 42;
const TEST_INVALID_RUNTIME_CWD = 123;
const TEST_INVALID_RUNTIME_HOMEDIR = 42;
const TEST_TAG_WARNING_EXTRA_COUNT = 1;
const TEST_POSITIVE_TIMESTAMP_MS = 1;
const TEST_FILTER_FAILURE_MESSAGE = "compress validation failed: protected segment altered";
const TEST_FILTER_FALLBACK_WARNING_PREFIX =
  "[memory-mason] capture filter failed; using uncompressed sanitized transcript";

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

afterEach(() => {
  cleanupGeneratedArtifacts();
});

describe("entrypoint config readers", () => {
  const scriptName = ENTRYPOINT;
  const scriptModule = preCompact;

  it(`reads .env text for ${scriptName}`, () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=/vault/path\n${ENV_KEY_SUBFOLDER}=notes`;

    writeText(path.join(cwd, DOTENV_FILE_NAME), envText);

    expect(scriptModule.readDotEnvText(cwd)).toBe(envText);
    expect(scriptModule.readDotEnvText(createTempDir(EMPTY_CWD_PREFIX))).toBe("");
  });

  it(`reads global config text for ${scriptName}`, () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const configText = JSON.stringify({ vaultPath: "/vault", subfolder: "notes" });

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, GLOBAL_CONFIG_FILE_NAME), configText);

    expect(scriptModule.readGlobalConfigText(homeDir)).toBe(configText);
    expect(scriptModule.readGlobalConfigText(createTempDir(EMPTY_HOME_PREFIX))).toBe("");
  });

  it(`reads global .env text for ${scriptName}`, () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=~/vault\n${ENV_KEY_SUBFOLDER}=global-brain`;

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, DOTENV_FILE_NAME), envText);

    expect(scriptModule.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(scriptModule.readGlobalDotEnvText(createTempDir(EMPTY_HOME_PREFIX))).toBe("");
  });

  it(`reads memory-mason.json config for ${scriptName} when env vault path is absent`, () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER, captureMode: CAPTURE_MODE_FULL }),
    );
    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: { cwd, transcript_path: transcriptPath, session_id: "cfg-test" },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1), UTF8_ENCODING),
    ).toContain("cfg-test / pre-compact");
  });
});

describe("pre-compact.js", () => {
  it("skips when invoked by another Memory Mason command", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, {
        [ENV_KEY_VAULT_PATH]: vaultPath,
        [ENV_KEY_INVOKED_BY]: "mmc",
      }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("skips when transcript file missing", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        cwd: hooksRoot,
        transcript_path: path.join(hooksRoot, "missing.jsonl"),
        session_id: "session-1",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("skips when transcript excerpt too small", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_SHORT));

    runHookEntrypoint(ENTRYPOINT, {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("skips when transcript excerpt too small in full mode", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_SHORT));

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-short-full",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
    });
  });

  it("writes excerpt and capture state for valid transcript", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
      const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
      expect(result.status).toBe(0);
      expect(fs.readFileSync(dailyPath, UTF8_ENCODING)).toContain("session-1 / pre-compact");
      expect(fs.readFileSync(dailyPath, UTF8_ENCODING)).toContain("**User:** user turn");
      expect(JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING)).lastCapture.source).toBe(
        HOOK_EVENT_PRE_COMPACT_KEBAB,
      );
    }));

  it("strips memory tags from transcript markdown before vault write", () =>
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
            content: "user<system-reminder>tag content</system-reminder>",
          },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-3" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-3" } }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-strip-tags",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
      const dailyContent = fs.readFileSync(dailyPath, UTF8_ENCODING);

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("user");
      expect(dailyContent).toContain("assistant");
      expect(dailyContent).not.toContain("<system-reminder>");
      expect(dailyContent).not.toContain("tag content");
    }));

  it("preserves user wording while compressing assistant transcript turns", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const transcript = [
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_USER, content: "just run tests" },
        }),
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "I will just run tests really quickly",
          },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-3" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-3" } }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-preserve-user-wording",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
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
    }));

  it("returns tag warning when stripped tag count exceeds max and still writes", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const tagBlock = "<system-reminder>x</system-reminder>";
      const tagCount = MAX_TAG_STRIP_COUNT + TEST_TAG_WARNING_EXTRA_COUNT;
      const heavyTurn = `visible-${tagBlock.repeat(tagCount)}`;

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD, heavyTurn));

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-tag-warning",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_TAG_LIMIT_PREFIX);
      expect(dailyContent).toContain("visible-");
    }));

  it("returns tag warning for short transcript skip when tag count exceeds max", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const tagBlock = "<system-reminder>x</system-reminder>";
      const heavyTurn = `short-${tagBlock.repeat(MAX_TAG_STRIP_COUNT + TEST_TAG_WARNING_EXTRA_COUNT)}`;

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_SHORT, heavyTurn));

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-short-tag-warning",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_TAG_LIMIT_PREFIX);
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
    }));

  it("returns tag warning on duplicate skip when tag count exceeds max", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const tagBlock = "<system-reminder>x</system-reminder>";
      const heavyTurn = `duplicate-${tagBlock.repeat(MAX_TAG_STRIP_COUNT + TEST_TAG_WARNING_EXTRA_COUNT)}`;

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD, heavyTurn));

      runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-duplicate-tag-warning",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
      const firstContent = fs.readFileSync(dailyPath, UTF8_ENCODING);

      const duplicateResult = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-duplicate-tag-warning",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(duplicateResult.status).toBe(0);
      expect(duplicateResult.stderr).toContain(HOOK_WARNING_TAG_LIMIT_PREFIX);
      expect(fs.readFileSync(dailyPath, UTF8_ENCODING)).toBe(firstContent);
    }));

  it("uses sanitized markdown for capture record hash", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const sessionId = "session-sanitized-hash";
      const transcript = [
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_USER,
            content: "hash<system-reminder>remove-me</system-reminder>",
          },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-3" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-3" } }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: sessionId,
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const turns = parseJsonlTranscript(transcript, CAPTURE_MODE_FULL);
      const sanitizedMarkdown = renderTurnsAsMarkdown(
        turns.map((turn) => ({
          ...turn,
          content:
            turn.role === TRANSCRIPT_ROLE_ASSISTANT
              ? compressNarrativeText(stripVTControlCharacters(stripMemoryTags(turn.content)))
              : stripVTControlCharacters(stripMemoryTags(turn.content)),
        })),
      );
      const expectedSanitizedRecord = buildCaptureRecord(
        sessionId,
        HOOK_EVENT_PRE_COMPACT_KEBAB,
        sanitizedMarkdown,
        TEST_POSITIVE_TIMESTAMP_MS,
      );
      const expectedRawRecord = buildCaptureRecord(
        sessionId,
        HOOK_EVENT_PRE_COMPACT_KEBAB,
        renderTurnsAsMarkdown(turns),
        TEST_POSITIVE_TIMESTAMP_MS,
      );
      const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
      const state = JSON.parse(fs.readFileSync(statePath, UTF8_ENCODING));

      expect(result.status).toBe(0);
      expect(state.lastCapture.contentHash).toBe(expectedSanitizedRecord.contentHash);
      expect(state.lastCapture.contentHash).not.toBe(expectedRawRecord.contentHash);
    }));

  it("writes full transcript without turn or character truncation", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const longFirstTurn = `first-user-turn-${"x".repeat(TEST_LONG_FIRST_TURN_REPEAT_COUNT)}`;

      writeText(
        transcriptPath,
        buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_EXTENDED, longFirstTurn),
      );

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-pre-compact",
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
    }));

  it("skips empty transcript file without writing capture", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, "");

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-empty-transcript",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
      expect(fs.existsSync(resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER))).toBe(false);
    }));

  it("skips transcript files whose lines do not parse into turns", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, "not-json\n{broken");

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-invalid-turns",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
      expect(fs.existsSync(resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER))).toBe(false);
    }));

  it("returns tag warning when sanitized transcript becomes empty after stripping", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const tagBlock = "<system-reminder>x</system-reminder>";
      const strippedTurn = tagBlock.repeat(MAX_TAG_STRIP_COUNT + TEST_TAG_WARNING_EXTRA_COUNT);
      const transcript = [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: strippedTurn } }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-empty-after-strip-warning",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_TAG_LIMIT_PREFIX);
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
      expect(fs.existsSync(resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER))).toBe(false);
    }));

  it("skips sanitized-empty transcript without warning when tag count stays under limit", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const strippedTurn = "<system-reminder>x</system-reminder>";
      const transcript = [
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: strippedTurn } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: strippedTurn } }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-empty-after-strip",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
      expect(fs.existsSync(resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER))).toBe(false);
    }));

  it("skips transcript when assistant-only turns compress to empty", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const transcript = Array.from({ length: TEST_TRANSCRIPT_TURN_COUNT_STANDARD }, () =>
        JSON.stringify({
          message: {
            role: TRANSCRIPT_ROLE_ASSISTANT,
            content: "just really basically actually simply",
          },
        }),
      ).join("\n");

      writeText(transcriptPath, transcript);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-empty-after-compress",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
      expect(fs.existsSync(resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER))).toBe(false);
    }));
  it("lite mode skips pre-compact entirely", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const transcript = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "u1" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "u2" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "u3" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a3" } }),
    ].join("\n");

    writeText(transcriptPath, transcript);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-lite-skip",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("lite mode skips pre-compact (system-reminder test)", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-lite-skip-2",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
  });

  it("full mode via project JSON preserves tags in persisted markdown", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const transcript = [
      JSON.stringify({
        message: { role: TRANSCRIPT_ROLE_USER, content: "u1<thinking>hidden</thinking>" },
      }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "u2" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "u3" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a3" } }),
    ].join("\n");

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify(
        { vaultPath, subfolder: DEFAULT_SUBFOLDER, captureMode: CAPTURE_MODE_FULL },
        null,
        2,
      ),
    );
    writeText(transcriptPath, transcript);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-full-preserve-tags",
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

  it("skips duplicate capture within duplicate window", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));

      runHookEntrypoint(ENTRYPOINT, {
        payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });
      const dailyPath = buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1);
      const firstContent = fs.readFileSync(dailyPath, UTF8_ENCODING);

      runHookEntrypoint(ENTRYPOINT, {
        payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(fs.readFileSync(dailyPath, UTF8_ENCODING)).toBe(firstContent);
    }));

  it("returns sensitive-content warning and skips write when transcript contains .env reference", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const transcript = [
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_USER, content: "read my .env file" },
        }),
        JSON.stringify({
          message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "contents of .env file" },
        }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-2" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-3" } }),
        JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-3" } }),
      ].join("\n");

      writeText(transcriptPath, transcript);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-sensitive",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_SENSITIVE_SKIP_PREFIX);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
    }));

  it("falls back to raw transcript when compression fails and still writes capture", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const codeBlock = "```\nsome just code\n```";
      const originalIncludes = String.prototype.includes;
      const includesSpy = vi.spyOn(String.prototype, "includes").mockImplementation(function (
        searchValue,
        ...rest
      ) {
        if (searchValue === codeBlock) {
          return false;
        }

        return originalIncludes.call(this, searchValue, ...rest);
      });

      try {
        const projectCwd = createTempDir(TEST_CWD_PREFIX);
        const homeDir = createTempDir(TEST_HOME_PREFIX);
        const vaultPath = createTempDir(TEST_VAULT_PREFIX);
        const transcriptPath = path.join(
          createTempDir(TEST_TRANSCRIPT_PREFIX),
          TEST_DEFAULT_TRANSCRIPT_FILE,
        );
        const env = buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        });
        const transcript = [
          JSON.stringify({
            message: {
              role: TRANSCRIPT_ROLE_USER,
              content: "\u001b[31mjust run<system-reminder>hidden</system-reminder> tests\u001b[0m",
            },
          }),
          JSON.stringify({
            message: {
              role: TRANSCRIPT_ROLE_ASSISTANT,
              content: codeBlock,
            },
          }),
          JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-2" } }),
          JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-2" } }),
          JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "user-3" } }),
          JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "assistant-3" } }),
        ].join("\n");

        materializeProjectDotEnvConfig(projectCwd, env, generatedEnvPaths);
        writeText(transcriptPath, transcript);

        const result = preCompact.run(
          JSON.stringify({
            cwd: projectCwd,
            transcript_path: transcriptPath,
            session_id: "session-filter-fallback",
          }),
          {
            env,
            cwd: projectCwd,
            homedir: homeDir,
          },
        );

        const dailyContent = fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toContain(TEST_FILTER_FALLBACK_WARNING_PREFIX);
        expect(result.stderr).toContain(TEST_FILTER_FAILURE_MESSAGE);
        expect(dailyContent).toContain("session-filter-fallback / pre-compact");
        expect(dailyContent).toContain("**User:** just run tests");
        expect(dailyContent).toContain(`**Assistant:** ${codeBlock}`);
        expect(dailyContent).not.toContain("<system-reminder>");
        expect(dailyContent).not.toContain("hidden");
        expect(dailyContent).not.toContain("\u001b");
      } finally {
        includesSpy.mockRestore();
      }
    }));

  it("reports invalid stdin to stderr", () => {
    const result = runHookEntrypoint(ENTRYPOINT, {
      stdinText: "{bad",
      env: buildEnv(createTempDir(TEST_HOME_PREFIX)),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin: {bad");
  });
});

describe("run - mm suppression", () => {
  it("skips pre-compact capture when mmSuppressed is true", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));
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
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-mm-true" },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("skips pre-compact capture in full mode when mmSuppressed is true", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));
      writeText(statePath, JSON.stringify({ lastCapture: null, mmSuppressed: true }, null, 2));

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-mm-full-true",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
    });
  });

  it("continues pre-compact capture when mmSuppressed is false", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const transcriptPath = path.join(
        createTempDir(TEST_TRANSCRIPT_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));
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

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-mm-false",
        },
        env: buildEnv(homeDir, {
          [ENV_KEY_VAULT_PATH]: vaultPath,
        }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("session-mm-false / pre-compact");
    }));
});

describe("run - sync flag", () => {
  it("returns status 0 without writing to vault when sync is false", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_TRANSCRIPT_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER, sync: false }),
    );
    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-sync-false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });
});

describe("pre-compact.js readStdin", () => {
  it("reads single chunk from mocked fd 0", () => {
    const payload = JSON.stringify({ session_id: "s1" });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      preCompact.readStdin({
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
    expect(preCompact.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("pre-compact.js firstNonEmptyString", () => {
  it("throws when values is not an array", () => {
    expect(() => preCompact.firstNonEmptyString("not-an-array")).toThrow("values must be an array");
    expect(() => preCompact.firstNonEmptyString(null)).toThrow("values must be an array");
    expect(() => preCompact.firstNonEmptyString(TEST_INVALID_NON_ARRAY_INPUT)).toThrow(
      "values must be an array",
    );
  });
});

describe("pre-compact.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = preCompact.run(JSON.stringify({ cwd: createTempDir(TEST_MM_CWD_PREFIX) }), {
      env: null,
      cwd: TEST_INVALID_RUNTIME_CWD,
      homedir: TEST_INVALID_RUNTIME_HOMEDIR,
    });
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const transcriptPath = path.join(
      createTempDir(TEST_MM_TR_PREFIX),
      TEST_DEFAULT_TRANSCRIPT_FILE,
    );

    writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));

    const result = preCompact.run(
      JSON.stringify({ transcript_path: transcriptPath, session_id: "nocwd" }),
      {
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
        cwd: createTempDir("mm-fb-"),
        homedir: homeDir,
      },
    );

    expect(result.status).toBe(0);
  });
});

describe("pre-compact.js main", () => {
  it("reads stdin via mock fs and calls exit", () =>
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
      const env = buildEnv(homeDir, {
        [ENV_KEY_VAULT_PATH]: vaultPath,
      });
      const transcriptPath = path.join(
        createTempDir(TEST_MM_TR_PREFIX),
        TEST_DEFAULT_TRANSCRIPT_FILE,
      );
      writeText(transcriptPath, buildTranscript(TEST_TRANSCRIPT_TURN_COUNT_STANDARD));
      const projectCwd = createTempDir(TEST_MM_CWD_PREFIX);
      const payload = JSON.stringify({
        cwd: projectCwd,
        transcript_path: transcriptPath,
        session_id: "session-main",
      });
      const buf = Buffer.from(payload);
      let rc = 0;
      const errors = [];
      let exitCode = null;
      materializeProjectDotEnvConfig(projectCwd, env, generatedEnvPaths);
      preCompact.main({
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
        cwd: projectCwd,
        env,
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
      expect(errors).toHaveLength(0);
    }));

  it("writes stderr on error", () => {
    const buf = Buffer.from("{bad-json");
    let rc = 0;
    const errors = [];
    let exitCode = null;
    preCompact.main({
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

