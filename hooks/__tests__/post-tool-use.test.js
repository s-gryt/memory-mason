"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  USER_INPUT_TOOLS,
  NOISY_TOOLS,
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
const { resolveCaptureStatePath } = require("../lib/capture/capture-state");
const postToolUse = require("../post-tool-use");
const { materializeProjectDotEnvConfig } = require("./helpers/project-dot-env");
const {
  TEST_VAULT_PREFIX,
  TEST_HOME_PREFIX,
  TEST_CWD_PREFIX,
  TEST_MM_HOME_PREFIX,
  TEST_MM_VAULT_PREFIX,
  TEST_MM_CWD_PREFIX,
  TEST_CAPTURE_MODE_LITE: CAPTURE_MODE_LITE,
  TEST_CAPTURE_MODE_FULL: CAPTURE_MODE_FULL,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_HOOK_ENTRY_POST_TOOL_USE: HOOK_ENTRY_POST_TOOL_USE,
  TEST_HOOK_EVENT_POST_TOOL_USE_KEBAB: HOOK_EVENT_POST_TOOL_USE_KEBAB,
  TEST_TRANSCRIPT_BLOCK_TYPE_TEXT: TRANSCRIPT_BLOCK_TYPE_TEXT,
} = require("./helpers/test-constants");
const {
  generatedEnvPaths,
  createTempDir,
  buildEnv,
  writeText,
  today,
  cleanupGeneratedArtifacts,
  runHookEntrypoint,
} = require("./helpers/entrypoint-runtime");
const hooksRoot = path.resolve(__dirname, "..");
const ENTRYPOINT = "post-tool-use.js";
const TOOL_WRITE = "Write";
const TOOL_BASH = "bash";
const EMPTY_CWD_PREFIX = "memory-mason-cwd-empty-";
const EMPTY_HOME_PREFIX = "memory-mason-home-empty-";
const TEST_INVALID_TOOL_RESPONSE_NUMBER = 42;
const ONE = 1;
const FIVE = 5;
const TAG_COUNT_OVER_LIMIT = MAX_TAG_STRIP_COUNT + ONE;
const SYSTEM_REMINDER_BLOCK = "<system-reminder>text</system-reminder>";

const DEFAULT_SKIP_PAYLOAD = Object.freeze({
  toolName: TOOL_WRITE,
  exitCode: null,
  strippedResultText: "ok",
  filePath: "",
  lineCount: ONE,
  commandText: "",
});

const createSkipPayload = (overrides = {}) => ({
  ...DEFAULT_SKIP_PAYLOAD,
  ...overrides,
});

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
  const scriptModule = postToolUse;

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
});

describe("post-tool-use.js", () => {
  it("writes tool output for copilot vscode payloads", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hookEventName: HOOK_EVENT_POST_TOOL_USE_KEBAB,
          cwd: hooksRoot,
          tool_name: "Edit",
          tool_response: "Error: patched file",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("patched file");
    });
  });

  it("writes structured tool output for claude payloads", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_WRITE,
          tool_response: {
            stdout: "Error: grep hit 1\ngrep hit 2",
            stderr: "",
            interrupted: false,
            isImage: false,
          },
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("grep hit 1");
      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("stdout");
    });
  });

  it("writes text blocks for structured claude tool outputs", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: "apply_patch",
          tool_response: [
            { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "Error: match 1" },
            { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "match 2" },
          ],
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("match 1");
      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("match 2");
    });
  });

  it("writes tool output for copilot cli payloads", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      runHookEntrypoint(ENTRYPOINT, {
        payload: {
          timestamp: "2026-04-27T10:00:00.000Z",
          cwd: hooksRoot,
          toolName: "apply_patch",
          toolResult: { textResultForLlm: "Error: patch ok" },
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("patch ok");
    });
  });

  it("writes tool output for codex payloads", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: "post_tool_use",
          turn_id: "turn-1",
          cwd: hooksRoot,
          tool_name: "apply_patch",
          tool_result: "Error: codex result",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("codex result");
    });
  });

  it("skips tool output in lite mode", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: hooksRoot,
        tool_name: TOOL_WRITE,
        tool_response: "should not be captured in lite",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("skips AskUserQuestion tool output in lite mode", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: hooksRoot,
        tool_name: "AskUserQuestion",
        tool_response: "user said: do the thing",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("skips noisy tools in full mode", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hookEventName: HOOK_EVENT_POST_TOOL_USE_KEBAB,
          cwd: hooksRoot,
          tool_name: "Read",
          tool_response: "ignored",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today()))).toBe(false);
    });
  });

  it("skips sequential thinking tool output in full mode as noise", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hookEventName: HOOK_EVENT_POST_TOOL_USE_KEBAB,
          cwd: hooksRoot,
          tool_name: "mcp_sequentialthi_sequentialthinking",
          tool_response: "internal reasoning step",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
    });
  });

  it("skips Bash ls command output in full mode as exploration", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_BASH,
          tool_response: "listing files",
          tool_input: {
            command: "ls -la",
          },
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
    });
  });

  it("captures Write error output in lite mode", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: hooksRoot,
        tool_name: TOOL_WRITE,
        tool_response: "Error: file not found",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1), UTF8_ENCODING),
    ).toContain("Error: file not found");
  });

  it("captures Write test results output in lite mode", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: hooksRoot,
        tool_name: TOOL_WRITE,
        tool_response: `${FIVE} tests passed`,
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1), UTF8_ENCODING),
    ).toContain("5 tests passed");
  });

  it("captures Write output for plan paths in full mode", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_WRITE,
          tool_response: "plan body",
          tool_input: {
            file_path: ".claude/plans/foo.md",
          },
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(
        fs.readFileSync(
          buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
          UTF8_ENCODING,
        ),
      ).toContain("plan body");
    });
  });

  it("returns sensitive-content warning and skips write when output references .env", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_WRITE,
          tool_response: "Error: .env file not found",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_SENSITIVE_SKIP_PREFIX);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
    });
  });

  it("skips tool output with only removable system tags as noise", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_WRITE,
          tool_response: SYSTEM_REMINDER_BLOCK,
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
        false,
      );
    });
  });

  it("returns tag-limit warning and still writes when tag count exceeds max", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const taggedOutput = `${SYSTEM_REMINDER_BLOCK.repeat(TAG_COUNT_OVER_LIMIT)}Error: tag burst`;

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_WRITE,
          tool_response: taggedOutput,
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(HOOK_WARNING_TAG_LIMIT_PREFIX);
      expect(dailyContent).toContain("Error: tag burst");
    });
  });

  it("reports invalid payloads to stderr", () => {
    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: { cwd: hooksRoot },
      env: buildEnv(createTempDir(TEST_HOME_PREFIX)),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("cannot detect platform from stdin shape:");
  });
});

describe("run - mm suppression", () => {
  it("skips tool write when mmSuppressed is true", () => {
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
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: hooksRoot,
        tool_name: TOOL_WRITE,
        tool_response: "should be skipped",
      },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("writes tool output when mmSuppressed is false", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);
      const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

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
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_WRITE,
          tool_response: "Error: tool output when not suppressed",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("tool output when not suppressed");
    });
  });

  it("writes tool output when capture state file does not exist", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_VAULT_PREFIX);

      const result = runHookEntrypoint(ENTRYPOINT, {
        payload: {
          hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
          cwd: hooksRoot,
          tool_name: TOOL_WRITE,
          tool_response: "Error: tool output with missing state",
        },
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
        UTF8_ENCODING,
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("tool output with missing state");
    });
  });
});

describe("run - sync flag", () => {
  it("returns status 0 without writing to vault when sync is false", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const cwd = createTempDir(TEST_CWD_PREFIX);

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify(
        {
          vaultPath,
          subfolder: DEFAULT_SUBFOLDER,
          sync: false,
        },
        null,
        2,
      ),
    );

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd,
        tool_name: TOOL_WRITE,
        tool_response: "should be skipped when sync is false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1))).toBe(
      false,
    );
  });

  it("proceeds normally when sync is true", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const cwd = createTempDir(TEST_CWD_PREFIX);

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify(
        {
          vaultPath,
          subfolder: DEFAULT_SUBFOLDER,
          sync: true,
          captureMode: CAPTURE_MODE_FULL,
        },
        null,
        2,
      ),
    );

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd,
        tool_name: TOOL_WRITE,
        tool_response: "Error: tool output when sync is enabled",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1),
      UTF8_ENCODING,
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("tool output when sync is enabled");
  });
});

describe("post-tool-use.js readStdin", () => {
  it("returns valid JSON string from mocked fd 0", () => {
    const payload = JSON.stringify({ tool_name: TOOL_WRITE, tool_response: "ok" });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      postToolUse.readStdin({
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
    expect(postToolUse.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("post-tool-use.js serializeToolResponse", () => {
  it("returns empty string for null/undefined/numeric/boolean", () => {
    expect(postToolUse.serializeToolResponse(null)).toBe("");
    expect(postToolUse.serializeToolResponse(undefined)).toBe("");
    expect(postToolUse.serializeToolResponse(TEST_INVALID_TOOL_RESPONSE_NUMBER)).toBe("");
    expect(postToolUse.serializeToolResponse(true)).toBe("");
  });

  it("returns string as-is", () => {
    expect(postToolUse.serializeToolResponse("hello")).toBe("hello");
  });

  it("returns JSON.stringify for plain object", () => {
    const obj = { stdout: "out" };
    expect(postToolUse.serializeToolResponse(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it("joins text blocks for array with valid text blocks", () => {
    expect(
      postToolUse.serializeToolResponse([
        { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "a" },
        { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("falls back to JSON for array with non-text blocks only", () => {
    const arr = [{ type: "image", url: "x" }];
    expect(postToolUse.serializeToolResponse(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  it("falls back to JSON for array with empty text blocks", () => {
    const arr = [
      { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "   " },
      { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "" },
    ];
    expect(postToolUse.serializeToolResponse(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  it("filters out null, non-object, non-text-type, non-string-text elements", () => {
    const arr = [
      null,
      "str",
      { type: "image", text: "no" },
      { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: null },
      { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "yes" },
    ];
    expect(postToolUse.serializeToolResponse(arr)).toBe("yes");
  });
});

describe("constants", () => {
  it("USER_INPUT_TOOLS contains AskUserQuestion", () => {
    expect(USER_INPUT_TOOLS.has("AskUserQuestion")).toBe(true);
  });

  it("NOISY_TOOLS contains expected noisy tool names", () => {
    expect(NOISY_TOOLS.has("Read")).toBe(true);
    expect(NOISY_TOOLS.has("Glob")).toBe(true);
    expect(NOISY_TOOLS.has("mcp_sequentialthi_sequentialthinking")).toBe(false);
  });

  it("NOISY_TOOLS does not contain AskUserQuestion", () => {
    expect(NOISY_TOOLS.has("AskUserQuestion")).toBe(false);
  });
});

describe("shouldSkipToolPayload", () => {
  it("skips empty tool name in lite", () => {
    expect(
      postToolUse.shouldSkipToolPayload(createSkipPayload({ toolName: "" }), CAPTURE_MODE_LITE),
    ).toBe(true);
  });

  it("skips noisy Read tool in full mode", () => {
    expect(
      postToolUse.shouldSkipToolPayload(createSkipPayload({ toolName: "Read" }), CAPTURE_MODE_FULL),
    ).toBe(true);
  });

  it("skips exploration bash command in full mode", () => {
    expect(
      postToolUse.shouldSkipToolPayload(
        createSkipPayload({ toolName: TOOL_BASH, commandText: "ls -la" }),
        CAPTURE_MODE_FULL,
      ),
    ).toBe(true);
  });

  it("captures error classification in lite mode", () => {
    expect(
      postToolUse.shouldSkipToolPayload(
        createSkipPayload({ strippedResultText: "Error: file not found" }),
        CAPTURE_MODE_LITE,
      ),
    ).toBe(false);
  });

  it("captures test_result classification in lite mode", () => {
    expect(
      postToolUse.shouldSkipToolPayload(
        createSkipPayload({ strippedResultText: "5 tests passed" }),
        CAPTURE_MODE_LITE,
      ),
    ).toBe(false);
  });

  it("skips noise classification in lite mode", () => {
    expect(
      postToolUse.shouldSkipToolPayload(
        createSkipPayload({ strippedResultText: "ok" }),
        CAPTURE_MODE_LITE,
      ),
    ).toBe(true);
  });

  it("captures plan output classification in full mode", () => {
    expect(
      postToolUse.shouldSkipToolPayload(
        createSkipPayload({
          toolName: TOOL_WRITE,
          filePath: ".claude/plans/foo.md",
        }),
        CAPTURE_MODE_FULL,
      ),
    ).toBe(false);
  });

  it("skips tag-only content in full mode", () => {
    expect(
      postToolUse.shouldSkipToolPayload(
        createSkipPayload({ strippedResultText: SYSTEM_REMINDER_BLOCK }),
        CAPTURE_MODE_FULL,
      ),
    ).toBe(true);
  });
});

describe("post-tool-use.js runtime fallback branches", () => {
  it("resolveRuntimeEnv falls back when env is null", () => {
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: createTempDir(TEST_MM_CWD_PREFIX),
        tool_name: TOOL_WRITE,
        tool_response: "x",
      }),
      { env: null, cwd: createTempDir(TEST_MM_CWD_PREFIX), homedir: createTempDir("mm-h-") },
    );
    expect(result.status).toBe(0);
  });

  it("resolveFallbackCwd falls back when cwd is not a string", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: homeDir,
        tool_name: TOOL_WRITE,
        tool_response: "x",
      }),
      {
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: createTempDir("mm-v-") }),
        cwd: 123,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });

  it("resolveRuntimeHomedir falls back when homedir is not a string", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: homeDir,
        tool_name: TOOL_WRITE,
        tool_response: "x",
      }),
      {
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: createTempDir("mm-v-") }),
        cwd: homeDir,
        homedir: 42,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("post-tool-use.js extractToolPayload", () => {
  it("extracts claude payload metadata from tool_input and tool_response", () => {
    const payload = postToolUse.extractToolPayload("claude-code", {
      tool_name: "Write",
      tool_response: { exitCode: ONE, stdout: "done" },
      tool_input: {
        filePaths: ["docs/plan.md"],
        command: "cat docs/plan.md",
      },
    });

    expect(payload).toEqual({
      toolName: "Write",
      resultText: JSON.stringify({ exitCode: ONE, stdout: "done" }, null, 2),
      filePath: "docs/plan.md",
      exitCode: ONE,
      commandText: "cat docs/plan.md",
    });
  });

  it("extracts copilot-cli metadata from toolArgs JSON", () => {
    const payload = postToolUse.extractToolPayload("copilot-cli", {
      toolName: "Write",
      toolResult: { textResultForLlm: "ok", exitCode: ONE },
      toolArgs: JSON.stringify({ file_path: "src/a.ts", command: "ls -la" }),
    });

    expect(payload).toEqual({
      toolName: "Write",
      resultText: "ok",
      filePath: "src/a.ts",
      exitCode: ONE,
      commandText: "ls -la",
    });
  });

  it("uses input exitCode when copilot-cli toolResult exitCode is absent", () => {
    const payload = postToolUse.extractToolPayload("copilot-cli", {
      toolName: "Write",
      toolResult: { textResultForLlm: "ok" },
      toolArgs: JSON.stringify({ path: "src/b.ts" }),
      exitCode: ONE,
    });

    expect(payload.exitCode).toBe(ONE);
    expect(payload.filePath).toBe("src/b.ts");
  });

  it("returns empty metadata when copilot-cli toolArgs JSON is invalid", () => {
    const payload = postToolUse.extractToolPayload("copilot-cli", {
      toolName: "Write",
      toolResult: { textResultForLlm: "ok" },
      toolArgs: "{invalid-json}",
    });

    expect(payload.filePath).toBe("");
    expect(payload.commandText).toBe("");
  });

  it("extracts codex metadata from tool_input", () => {
    const payload = postToolUse.extractToolPayload("codex", {
      tool_name: "Edit",
      tool_result: "patched",
      exitCode: ONE,
      tool_input: {
        path: "hooks/post-tool-use.js",
        command: "grep tool",
      },
    });

    expect(payload).toEqual({
      toolName: "Edit",
      resultText: "patched",
      filePath: "hooks/post-tool-use.js",
      exitCode: ONE,
      commandText: "grep tool",
    });
  });
});

describe("post-tool-use.js extractToolPayload unsupported platform", () => {
  it("throws for unsupported platform", () => {
    expect(() => postToolUse.extractToolPayload("unknown-platform", {})).toThrow(
      "unsupported platform: unknown-platform",
    );
  });
});

describe("post-tool-use.js MEMORY_MASON_INVOKED_BY skip", () => {
  it("returns empty when MEMORY_MASON_INVOKED_BY is set", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: createTempDir(TEST_MM_CWD_PREFIX),
        tool_name: TOOL_WRITE,
        tool_response: "x",
      }),
      {
        env: { [ENV_KEY_INVOKED_BY]: "mmc" },
        cwd: createTempDir(TEST_MM_CWD_PREFIX),
        homedir: homeDir,
      },
    );
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});

describe("post-tool-use.js readConfigText with existing file", () => {
  it("uses memory-mason.json when no env vault path is set", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const cwd = createTempDir(TEST_MM_CWD_PREFIX);

    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER, captureMode: CAPTURE_MODE_FULL }),
    );

    const result = runHookEntrypoint(ENTRYPOINT, {
      payload: {
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd,
        tool_name: TOOL_WRITE,
        tool_response: "Error: output",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, DEFAULT_SUBFOLDER, today(), 1), UTF8_ENCODING),
    ).toContain("output");
  });
});

describe("post-tool-use.js copilot-cli payload branches", () => {
  it("falls back to empty object when toolResult is null", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const result = postToolUse.run(
      JSON.stringify({
        timestamp: "2025-01-01T00:00:00.000Z",
        toolName: TOOL_WRITE,
        toolResult: null,
      }),
      {
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
        cwd: homeDir,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("post-tool-use.js input cwd fallback branch", () => {
  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        tool_name: TOOL_WRITE,
        tool_response: "x",
      }),
      {
        env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
        cwd: homeDir,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("post-tool-use.js main", () => {
  it("calls exit 0 after writing tool output", () => {
    withProcessCaptureMode(CAPTURE_MODE_FULL, () => {
      const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
      const vaultPath = createTempDir(TEST_MM_VAULT_PREFIX);
      const env = buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath });
      const payload = JSON.stringify({
        hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
        cwd: homeDir,
        tool_name: TOOL_WRITE,
        tool_response: "main out",
      });
      const buf = Buffer.from(payload);
      let rc = 0;
      const writes = [];
      const errors = [];
      let exitCode = null;
      materializeProjectDotEnvConfig(homeDir, env, generatedEnvPaths);
      postToolUse.main({
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
        cwd: homeDir,
        env,
        homedir: homeDir,
      });
      expect(exitCode).toBe(0);
      expect(errors).toHaveLength(0);
    });
  });

  it("writes stderr on config failure", () => {
    const homeDir = createTempDir(TEST_MM_HOME_PREFIX);
    const payload = JSON.stringify({
      hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
      cwd: createTempDir("mm-nocfg-"),
      tool_name: TOOL_WRITE,
      tool_response: "x",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = [];
    let exitCode = null;
    postToolUse.main({
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
    const payload = JSON.stringify({
      hook_event_name: HOOK_ENTRY_POST_TOOL_USE,
      cwd: homeDir,
      tool_name: "Read",
      tool_response: "",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const result = postToolUse.main({
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
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      homedir: homeDir,
    });
    expect(result.status).toBe(0);
  });
});
