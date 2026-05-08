"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  SESSION_START_RECENT_LOG_LINES,
  HOT_CACHE_CONTEXT_MAX_CHARS,
  INDEX_CONTEXT_MAX_CHARS,
} = require("../../lib/vault/constants");
const { UTF8_ENCODING } = require("../../lib/shared/constants");
const { ROOT_INDEX_FILE_NAME, DAILY_META_FILE_NAME } = require("../../lib/vault/vault-paths");
const {
  ENV_KEY_VAULT_PATH,
  ENV_KEY_SUBFOLDER,
  PROJECT_CONFIG_FILE_NAME,
  DOTENV_FILE_NAME,
  GLOBAL_MM_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
} = require("../../lib/config/constants");
const {
  TEST_HOME_PREFIX,
  TEST_VAULT_PREFIX,
  TEST_CWD_PREFIX,
  TEST_DEFAULT_DATE,
  TEST_DEFAULT_VAULT_PATH,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_HOOK_ENTRY_SESSION_START: HOOK_ENTRY_SESSION_START,
  TEST_KNOWLEDGE_BASE_INDEX_HEADING: KNOWLEDGE_BASE_INDEX_HEADING,
  TEST_SESSION_CONTEXT_HEADING: SESSION_CONTEXT_HEADING,
  TEST_PLACEHOLDER_NO_ARTICLES: PLACEHOLDER_NO_ARTICLES,
  TEST_PLACEHOLDER_NO_RECENT_DAILY_LOG: PLACEHOLDER_NO_RECENT_DAILY_LOG,
} = require("../helpers/test-constants");
const {
  buildDailyFilePath,
  buildRootIndexPath,
  buildSessionContextPath,
  buildDailyFolderPath,
} = require("../../lib/vault/vault");
const sessionStart = require("../../session-start");
const {
  createTempDir,
  buildEnv,
  writeText,
  today,
  cleanupGeneratedArtifacts,
  runHookEntrypoint,
} = require("../helpers/entrypoint-runtime");
const hooksRoot = path.resolve(__dirname, "..", "..");

const TWO = 2;
const ELEVEN = 11;
const FORTY = 40;
const HOT_CONTEXT_SENTINEL_LENGTH = HOT_CACHE_CONTEXT_MAX_CHARS + SESSION_START_RECENT_LOG_LINES;
const ENTRYPOINT_FILE = "session-start.js";
const FIRST_CHUNK_FILE = "001.md";
const SECOND_CHUNK_FILE = "002.md";
const THIRD_CHUNK_FILE = "003.md";

const createFsApiMock = (nodes) => {
  const hasNode = (targetPath) => Object.hasOwn(nodes, targetPath);

  return {
    existsSync(targetPath) {
      return hasNode(targetPath);
    },
    statSync(targetPath) {
      const node = nodes[targetPath];
      if (typeof node === "undefined") {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return {
        isDirectory: () => node.kind === "dir",
        isFile: () => node.kind === "file",
      };
    },
    readdirSync(targetPath) {
      const node = nodes[targetPath];
      if (typeof node === "undefined" || node.kind !== "dir") {
        throw new Error("not a directory");
      }
      return Array.isArray(node.entries) ? node.entries.slice() : [];
    },
    readFileSync(targetPath) {
      const node = nodes[targetPath];
      if (typeof node === "undefined" || node.kind !== "file") {
        throw new Error("not a file");
      }
      return node.content;
    },
  };
};

const _buildTranscript = (turnCount, firstUserContent = "user turn") =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % TWO === 0;
    const role = isUser ? "user" : "assistant";
    const content = isUser && index === 0 ? firstUserContent : `${role} turn ${index}`;
    return JSON.stringify({ message: { role, content } });
  }).join("\n");

const _buildVsCodeTranscript = (turns) => {
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

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(TWO, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

afterEach(() => {
  cleanupGeneratedArtifacts();
});

describe("entrypoint config readers", () => {
  it("reads .env text for session-start.js", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=/vault/path\n${ENV_KEY_SUBFOLDER}=notes`;

    writeText(path.join(cwd, DOTENV_FILE_NAME), envText);

    expect(sessionStart.readDotEnvText(cwd)).toBe(envText);
    expect(sessionStart.readDotEnvText(createTempDir(`${TEST_CWD_PREFIX}empty-`))).toBe("");
  });

  it("reads global config text for session-start.js", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const configText = JSON.stringify({ vaultPath: TEST_DEFAULT_VAULT_PATH, subfolder: "notes" });

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, GLOBAL_CONFIG_FILE_NAME), configText);

    expect(sessionStart.readGlobalConfigText(homeDir)).toBe(configText);
    expect(sessionStart.readGlobalConfigText(createTempDir(`${TEST_HOME_PREFIX}empty-`))).toBe("");
  });

  it("reads global .env text for session-start.js", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const envText = `${ENV_KEY_VAULT_PATH}=~/vault\n${ENV_KEY_SUBFOLDER}=global-brain`;

    writeText(path.join(homeDir, GLOBAL_MM_DIR_NAME, DOTENV_FILE_NAME), envText);

    expect(sessionStart.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(sessionStart.readGlobalDotEnvText(createTempDir(`${TEST_HOME_PREFIX}empty-`))).toBe("");
  });
});

describe("readDailyLogText", () => {
  it("throws when vaultPath is empty string", () => {
    const fsApi = createFsApiMock({});
    expect(() =>
      sessionStart.readDailyLogText("", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, fsApi),
    ).toThrow("vaultPath must be a non-empty string");
  });

  it("throws when vaultPath is not a string", () => {
    const fsApi = createFsApiMock({});
    expect(() =>
      sessionStart.readDailyLogText(null, DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, fsApi),
    ).toThrow("vaultPath must be a non-empty string");
  });

  it("reads last chunk when folder exists with chunks", () => {
    const vaultPath = TEST_DEFAULT_VAULT_PATH;
    const subfolder = DEFAULT_SUBFOLDER;
    const dateIso = TEST_DEFAULT_DATE;
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const chunkPath = path.join(folderPath, FIRST_CHUNK_FILE);

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: [FIRST_CHUNK_FILE, DAILY_META_FILE_NAME] },
      [chunkPath]: { kind: "file", content: "chunk one" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe("chunk one");
  });

  it("reads flat file when flat exists, no folder", () => {
    const vaultPath = TEST_DEFAULT_VAULT_PATH;
    const subfolder = DEFAULT_SUBFOLDER;
    const dateIso = TEST_DEFAULT_DATE;
    const flatPath = buildDailyFilePath(vaultPath, subfolder, dateIso);

    const fsApi = createFsApiMock({
      [flatPath]: { kind: "file", content: "flat file text" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe(
      "flat file text",
    );
  });

  it("returns empty string when neither exists", () => {
    const fsApi = createFsApiMock({});
    expect(
      sessionStart.readDailyLogText(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        TEST_DEFAULT_DATE,
        fsApi,
      ),
    ).toBe("");
  });

  it("reads highest numbered chunk when multiple exist", () => {
    const vaultPath = TEST_DEFAULT_VAULT_PATH;
    const subfolder = DEFAULT_SUBFOLDER;
    const dateIso = TEST_DEFAULT_DATE;
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const chunk1Path = path.join(folderPath, FIRST_CHUNK_FILE);
    const chunk2Path = path.join(folderPath, SECOND_CHUNK_FILE);
    const chunk3Path = path.join(folderPath, THIRD_CHUNK_FILE);

    const fsApi = createFsApiMock({
      [folderPath]: {
        kind: "dir",
        entries: [SECOND_CHUNK_FILE, DAILY_META_FILE_NAME, THIRD_CHUNK_FILE, FIRST_CHUNK_FILE],
      },
      [chunk1Path]: { kind: "file", content: "chunk one" },
      [chunk2Path]: { kind: "file", content: "chunk two" },
      [chunk3Path]: { kind: "file", content: "chunk three latest" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe(
      "chunk three latest",
    );
  });

  it("prefers folder chunk over flat file when both exist", () => {
    const vaultPath = TEST_DEFAULT_VAULT_PATH;
    const subfolder = DEFAULT_SUBFOLDER;
    const dateIso = TEST_DEFAULT_DATE;
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const flatPath = buildDailyFilePath(vaultPath, subfolder, dateIso);
    const chunkPath = path.join(folderPath, FIRST_CHUNK_FILE);

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: [FIRST_CHUNK_FILE] },
      [chunkPath]: { kind: "file", content: "chunk data" },
      [flatPath]: { kind: "file", content: "flat data" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe("chunk data");
  });

  it("returns empty string when folder exists with no chunk files", () => {
    const vaultPath = TEST_DEFAULT_VAULT_PATH;
    const subfolder = DEFAULT_SUBFOLDER;
    const dateIso = TEST_DEFAULT_DATE;
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: [DAILY_META_FILE_NAME, ROOT_INDEX_FILE_NAME] },
      [path.join(folderPath, DAILY_META_FILE_NAME)]: { kind: "file", content: "{}" },
      [path.join(folderPath, ROOT_INDEX_FILE_NAME)]: { kind: "file", content: "# Index" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe("");
  });
});

describe("readRecentDailyLog - chunked structure", () => {
  it("returns last 30 lines from latest chunk", () => {
    const vaultPath = TEST_DEFAULT_VAULT_PATH;
    const subfolder = DEFAULT_SUBFOLDER;
    const dateIso = today();
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const chunk1Path = path.join(folderPath, FIRST_CHUNK_FILE);
    const chunk2Path = path.join(folderPath, SECOND_CHUNK_FILE);
    const chunk2Content = Array.from(
      { length: FORTY },
      (_, index) => `line-${String(index + 1)}`,
    ).join("\n");
    const expected = Array.from(
      { length: SESSION_START_RECENT_LOG_LINES },
      (_, index) => `line-${String(index + ELEVEN)}`,
    ).join("\n");

    const fsApi = createFsApiMock({
      [folderPath]: {
        kind: "dir",
        entries: [FIRST_CHUNK_FILE, SECOND_CHUNK_FILE, DAILY_META_FILE_NAME],
      },
      [chunk1Path]: { kind: "file", content: "line-old" },
      [chunk2Path]: { kind: "file", content: chunk2Content },
    });

    expect(sessionStart.readRecentDailyLog(vaultPath, subfolder, fsApi)).toBe(expected);
  });
});

describe("session-start.js", () => {
  it("reads memory-mason.json and returns KB context with today log", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const configPath = path.join(cwd, PROJECT_CONFIG_FILE_NAME);
    const indexPath = buildRootIndexPath(vaultPath, DEFAULT_SUBFOLDER);
    const dailyPath = buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, today());

    writeText(configPath, JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER }));
    writeText(indexPath, "# Index\n\n[[Topic]]");
    writeText(dailyPath, "# Daily Log\n\nrecent line");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd },
      cwd,
      env: buildEnv(cwd),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(parsed.hookSpecificOutput.hookEventName).toBe(HOOK_ENTRY_SESSION_START);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("[[Topic]]");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("recent line");
  });

  it("falls back to yesterday log when today log missing", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const dailyPath = buildDailyFilePath(vaultPath, DEFAULT_SUBFOLDER, yesterday());

    writeText(dailyPath, "# Daily Log\n\nyesterday line");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("yesterday line");
  });

  it("uses empty placeholders when KB files are missing", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(PLACEHOLDER_NO_ARTICLES);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(PLACEHOLDER_NO_RECENT_DAILY_LOG);
  });

  it("uses session context when present and non-empty, applies 5000 char limit", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const subfolder = DEFAULT_SUBFOLDER;
    const configPath = path.join(cwd, PROJECT_CONFIG_FILE_NAME);
    const sessionContextPath = buildSessionContextPath(vaultPath, subfolder);
    const indexPath = buildRootIndexPath(vaultPath, subfolder);

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(sessionContextPath, `HOT_SENTINEL ${"x".repeat(HOT_CONTEXT_SENTINEL_LENGTH)}`);
    writeText(indexPath, "INDEX_SENTINEL");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd },
      cwd,
      env: buildEnv(cwd),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("HOT_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("INDEX_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(`## ${SESSION_CONTEXT_HEADING}`);
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain(
      `## ${KNOWLEDGE_BASE_INDEX_HEADING}`,
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain("...(truncated)");
  });

  it("falls back to index.md when session context is empty", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const subfolder = DEFAULT_SUBFOLDER;
    const configPath = path.join(cwd, PROJECT_CONFIG_FILE_NAME);
    const sessionContextPath = buildSessionContextPath(vaultPath, subfolder);
    const indexPath = buildRootIndexPath(vaultPath, subfolder);

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(sessionContextPath, "");
    writeText(indexPath, `INDEX_SENTINEL ${"x".repeat(INDEX_CONTEXT_MAX_CHARS)}`);

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd },
      cwd,
      env: buildEnv(cwd),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("INDEX_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("HOT_SENTINEL");
  });

  it("falls back to index.md when session context is missing", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const subfolder = DEFAULT_SUBFOLDER;
    const configPath = path.join(cwd, PROJECT_CONFIG_FILE_NAME);
    const indexPath = buildRootIndexPath(vaultPath, subfolder);

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(indexPath, `INDEX_SENTINEL ${"x".repeat(INDEX_CONTEXT_MAX_CHARS)}`);

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd },
      cwd,
      env: buildEnv(cwd),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("INDEX_SENTINEL");
  });

  it("includes both session context and recent daily log when both present", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const subfolder = DEFAULT_SUBFOLDER;
    const configPath = path.join(cwd, PROJECT_CONFIG_FILE_NAME);
    const sessionContextPath = buildSessionContextPath(vaultPath, subfolder);
    const dailyPath = buildDailyFilePath(vaultPath, subfolder, today());

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(sessionContextPath, `HOT_SENTINEL ${"y".repeat(FORTY)}`);
    writeText(dailyPath, "# Daily Log\n\nDAILY_SENTINEL");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd },
      cwd,
      env: buildEnv(cwd),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("HOT_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("DAILY_SENTINEL");
  });

  it("uses global config fallback when project config and env var are absent", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const dailyPath = buildDailyFilePath(vaultPath, "global-brain", today());

    writeText(
      path.join(homeDir, GLOBAL_MM_DIR_NAME, GLOBAL_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: "global-brain" }),
    );
    writeText(dailyPath, "# Daily Log\n\nfrom global config");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd },
      cwd,
      env: buildEnv(homeDir),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("from global config");
  });

  it("uses .env fallback when project config and env var are absent", () => {
    const cwd = createTempDir(TEST_CWD_PREFIX);
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const dailyPath = buildDailyFilePath(vaultPath, "dotenv-brain", today());

    writeText(
      path.join(cwd, DOTENV_FILE_NAME),
      `${ENV_KEY_VAULT_PATH}=${vaultPath}\n${ENV_KEY_SUBFOLDER}=dotenv-brain`,
    );
    writeText(dailyPath, "# Daily Log\n\nfrom dotenv config");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd },
      cwd,
      env: buildEnv(homeDir),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("from dotenv config");
  });

  it("reports invalid stdin to stderr", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      stdinText: "{not-json",
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin: {not-json");
  });
});

describe("run - sync flag", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns status 0 with empty additionalContext when sync is false", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);

    vi.spyOn(sessionStart, "resolveRuntimeConfig").mockReturnValue({
      vaultPath,
      subfolder: DEFAULT_SUBFOLDER,
      sync: false,
    });

    const existsSyncSpy = vi.spyOn(fs, "existsSync");
    const statSyncSpy = vi.spyOn(fs, "statSync");
    const readdirSyncSpy = vi.spyOn(fs, "readdirSync");
    const readFileSyncSpy = vi.spyOn(fs, "readFileSync");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd: hooksRoot, hookEventName: HOOK_ENTRY_SESSION_START },
      env: buildEnv(homeDir),
    });
    const parsed = JSON.parse(result.stdout);

    const touchedVaultPath = [existsSyncSpy, statSyncSpy, readdirSyncSpy, readFileSyncSpy].some(
      (spy) =>
        spy.mock.calls.some(
          ([targetPath]) => typeof targetPath === "string" && targetPath.startsWith(vaultPath),
        ),
    );

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.hookEventName).toBeTruthy();
    expect(parsed.hookSpecificOutput.additionalContext).toBe("");
    expect(touchedVaultPath).toBe(false);
  });

  it("proceeds normally when sync is true", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const subfolder = DEFAULT_SUBFOLDER;
    const indexPath = buildRootIndexPath(vaultPath, subfolder);
    const dailyPath = buildDailyFilePath(vaultPath, subfolder, today());

    writeText(indexPath, "# Index\n\nSYNC_TRUE_INDEX_SENTINEL");
    writeText(dailyPath, "# Daily Log\n\nSYNC_TRUE_DAILY_SENTINEL");

    vi.spyOn(sessionStart, "resolveRuntimeConfig").mockReturnValue({
      vaultPath,
      subfolder,
      sync: true,
    });

    const readFileSyncSpy = vi.spyOn(fs, "readFileSync");

    const result = runHookEntrypoint(ENTRYPOINT_FILE, {
      payload: { cwd: hooksRoot, hookEventName: HOOK_ENTRY_SESSION_START },
      env: buildEnv(homeDir),
    });
    const parsed = JSON.parse(result.stdout);

    const readFromVault = readFileSyncSpy.mock.calls.some(
      ([targetPath]) => typeof targetPath === "string" && targetPath.startsWith(vaultPath),
    );

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("SYNC_TRUE_INDEX_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("SYNC_TRUE_DAILY_SENTINEL");
    expect(readFromVault).toBe(true);
  });
});

describe("session-start.js readStdin", () => {
  it("returns valid JSON string from mocked fd 0", () => {
    const payload = JSON.stringify({ cwd: "/tmp", hookEventName: HOOK_ENTRY_SESSION_START });
    const payloadBuffer = Buffer.from(payload, UTF8_ENCODING);
    let callCount = 0;
    const mockFs = {
      readSync(_fd, chunk) {
        if (callCount === 0) {
          callCount++;
          payloadBuffer.copy(chunk, 0, 0, payloadBuffer.length);
          return payloadBuffer.length;
        }
        return 0;
      },
    };
    expect(sessionStart.readStdin(mockFs)).toBe(payload);
  });

  it("returns empty string when fd 0 yields zero bytes immediately", () => {
    expect(sessionStart.readStdin({ readSync: () => 0 })).toBe("");
  });

  it("concatenates multiple chunks before EOF", () => {
    const part1 = Buffer.from('{"cwd":');
    const part2 = Buffer.from('"/tmp"}');
    let callCount = 0;
    const mockFs = {
      readSync(_fd, chunk) {
        if (callCount === 0) {
          callCount++;
          part1.copy(chunk);
          return part1.length;
        }
        if (callCount === 1) {
          callCount++;
          part2.copy(chunk);
          return part2.length;
        }
        return 0;
      },
    };
    expect(sessionStart.readStdin(mockFs)).toBe('{"cwd":"/tmp"}');
  });
});

describe("session-start.js main", () => {
  it("writes stdout and calls exit with status 0 on success", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const cwd = createTempDir(TEST_CWD_PREFIX);
    writeText(
      path.join(cwd, PROJECT_CONFIG_FILE_NAME),
      JSON.stringify({ vaultPath, subfolder: DEFAULT_SUBFOLDER }),
    );
    const payload = JSON.stringify({ cwd });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = [];
    const errors = [];
    let exitCode = null;
    sessionStart.main({
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
      env: buildEnv(homeDir),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(writes.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });

  it("writes stderr when config is missing and still exits 0", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const payload = JSON.stringify({ cwd: createTempDir("mm-nocfg-") });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = [];
    const errors = [];
    let exitCode = null;
    sessionStart.main({
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
      cwd: createTempDir(`${TEST_CWD_PREFIX}fb-`),
      env: buildEnv(homeDir),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain(
      `Memory Mason config not found. Checked project ${DOTENV_FILE_NAME}, project ${PROJECT_CONFIG_FILE_NAME}, ~/${GLOBAL_MM_DIR_NAME}/${DOTENV_FILE_NAME}, and ~/${GLOBAL_MM_DIR_NAME}/${GLOBAL_CONFIG_FILE_NAME}.`,
    );
  });

  it("uses io fallback functions when stdout/stderr not provided", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const payload = JSON.stringify({ cwd: homeDir });
    const buf = Buffer.from(payload);
    let rc = 0;
    let exitCode = null;
    const result = sessionStart.main({
      io: {
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
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      homedir: homeDir,
    });
    expect(result.status).toBe(0);
    expect(exitCode).toBe(0);
  });
});

describe("session-start.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = sessionStart.run(JSON.stringify({ cwd: createTempDir(TEST_CWD_PREFIX) }), {
      env: null,
      cwd: 123,
      homedir: 42,
    });
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir(TEST_HOME_PREFIX);
    const vaultPath = createTempDir(TEST_VAULT_PREFIX);
    const result = sessionStart.run(JSON.stringify({}), {
      env: buildEnv(homeDir, { [ENV_KEY_VAULT_PATH]: vaultPath }),
      cwd: createTempDir(`${TEST_CWD_PREFIX}fb-cwd-`),
      homedir: homeDir,
    });
    expect(result.status).toBe(0);
  });

  it("handles non-Error throw via String coercion", () => {
    const result = sessionStart.run("not-json-at-all", {});
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON");
  });
});
