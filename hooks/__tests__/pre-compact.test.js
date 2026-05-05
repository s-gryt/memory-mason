"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UTF8_ENCODING } = require("../lib/constants");
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
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
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
