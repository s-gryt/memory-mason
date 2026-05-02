"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildDailyFilePath,
  buildKnowledgeIndexPath,
  buildHotCachePath,
  buildDailyFolderPath,
} = require("../lib/vault");
const sessionStart = require("../session-start");
const hooksRoot = path.resolve(__dirname, "..");

const tempDirs = [];

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

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

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
    const isUser = index % 2 === 0;
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
        timestamp: `2025-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
        parentId: index === 0 ? null : `entry-${index - 1}`,
      }),
    )
    .join("\n");
};

const runScript = (_scriptName, options = {}) => {
  let stdinText = "";
  if (typeof options.stdinText === "string") {
    stdinText = options.stdinText;
  } else if (typeof options.payload !== "undefined") {
    stdinText = JSON.stringify(options.payload);
  }
  const env = typeof options.env === "object" && options.env !== null ? options.env : process.env;
  const homedir =
    typeof env.USERPROFILE === "string" && env.USERPROFILE !== "" ? env.USERPROFILE : os.homedir();
  const extraRuntime =
    typeof options.runtime === "object" && options.runtime !== null ? options.runtime : {};
  const runtime = {
    cwd: typeof options.cwd === "string" ? options.cwd : hooksRoot,
    env,
    homedir,
    ...extraRuntime,
  };

  return sessionStart.run(stdinText, runtime);
};

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("entrypoint config readers", () => {
  it("reads .env text for session-start.js", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const envText = "MEMORY_MASON_VAULT_PATH=/vault/path\nMEMORY_MASON_SUBFOLDER=notes";

    writeText(path.join(cwd, ".env"), envText);

    expect(sessionStart.readDotEnvText(cwd)).toBe(envText);
    expect(sessionStart.readDotEnvText(createTempDir("memory-mason-cwd-empty-"))).toBe("");
  });

  it("reads global config text for session-start.js", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const configText = JSON.stringify({ vaultPath: "/vault", subfolder: "notes" });

    writeText(path.join(homeDir, ".memory-mason", "config.json"), configText);

    expect(sessionStart.readGlobalConfigText(homeDir)).toBe(configText);
    expect(sessionStart.readGlobalConfigText(createTempDir("memory-mason-home-empty-"))).toBe("");
  });

  it("reads global .env text for session-start.js", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const envText = "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=global-brain";

    writeText(path.join(homeDir, ".memory-mason", ".env"), envText);

    expect(sessionStart.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(sessionStart.readGlobalDotEnvText(createTempDir("memory-mason-home-empty-"))).toBe("");
  });
});

describe("readDailyLogText", () => {
  it("throws when vaultPath is empty string", () => {
    const fsApi = createFsApiMock({});
    expect(() => sessionStart.readDailyLogText("", "ai-knowledge", "2026-04-30", fsApi)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });

  it("throws when vaultPath is not a string", () => {
    const fsApi = createFsApiMock({});
    expect(() => sessionStart.readDailyLogText(null, "ai-knowledge", "2026-04-30", fsApi)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });

  it("reads last chunk when folder exists with chunks", () => {
    const vaultPath = "/vault";
    const subfolder = "ai-knowledge";
    const dateIso = "2026-04-30";
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const chunkPath = path.join(folderPath, "001.md");

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: ["001.md", "meta.json"] },
      [chunkPath]: { kind: "file", content: "chunk one" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe("chunk one");
  });

  it("reads flat file when flat exists, no folder", () => {
    const vaultPath = "/vault";
    const subfolder = "ai-knowledge";
    const dateIso = "2026-04-30";
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
    expect(sessionStart.readDailyLogText("/vault", "ai-knowledge", "2026-04-30", fsApi)).toBe("");
  });

  it("reads highest numbered chunk when multiple exist", () => {
    const vaultPath = "/vault";
    const subfolder = "ai-knowledge";
    const dateIso = "2026-04-30";
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const chunk1Path = path.join(folderPath, "001.md");
    const chunk2Path = path.join(folderPath, "002.md");
    const chunk3Path = path.join(folderPath, "003.md");

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: ["002.md", "meta.json", "003.md", "001.md"] },
      [chunk1Path]: { kind: "file", content: "chunk one" },
      [chunk2Path]: { kind: "file", content: "chunk two" },
      [chunk3Path]: { kind: "file", content: "chunk three latest" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe(
      "chunk three latest",
    );
  });

  it("prefers folder chunk over flat file when both exist", () => {
    const vaultPath = "/vault";
    const subfolder = "ai-knowledge";
    const dateIso = "2026-04-30";
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const flatPath = buildDailyFilePath(vaultPath, subfolder, dateIso);
    const chunkPath = path.join(folderPath, "001.md");

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: ["001.md"] },
      [chunkPath]: { kind: "file", content: "chunk data" },
      [flatPath]: { kind: "file", content: "flat data" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe("chunk data");
  });

  it("returns empty string when folder exists with no chunk files", () => {
    const vaultPath = "/vault";
    const subfolder = "ai-knowledge";
    const dateIso = "2026-04-30";
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: ["meta.json", "index.md"] },
      [path.join(folderPath, "meta.json")]: { kind: "file", content: "{}" },
      [path.join(folderPath, "index.md")]: { kind: "file", content: "# Index" },
    });

    expect(sessionStart.readDailyLogText(vaultPath, subfolder, dateIso, fsApi)).toBe("");
  });
});

describe("readRecentDailyLog - chunked structure", () => {
  it("returns last 30 lines from latest chunk", () => {
    const vaultPath = "/vault";
    const subfolder = "ai-knowledge";
    const dateIso = today();
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, dateIso);
    const chunk1Path = path.join(folderPath, "001.md");
    const chunk2Path = path.join(folderPath, "002.md");
    const chunk2Content = Array.from(
      { length: 40 },
      (_, index) => `line-${String(index + 1)}`,
    ).join("\n");
    const expected = Array.from({ length: 30 }, (_, index) => `line-${String(index + 11)}`).join(
      "\n",
    );

    const fsApi = createFsApiMock({
      [folderPath]: { kind: "dir", entries: ["001.md", "002.md", "meta.json"] },
      [chunk1Path]: { kind: "file", content: "line-old" },
      [chunk2Path]: { kind: "file", content: chunk2Content },
    });

    expect(sessionStart.readRecentDailyLog(vaultPath, subfolder, fsApi)).toBe(expected);
  });
});

describe("session-start.js", () => {
  it("reads memory-mason.json and returns KB context with today log", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const configPath = path.join(cwd, "memory-mason.json");
    const indexPath = buildKnowledgeIndexPath(vaultPath, "ai-knowledge");
    const dailyPath = buildDailyFilePath(vaultPath, "ai-knowledge", today());

    writeText(configPath, JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }));
    writeText(indexPath, "# Index\n\n[[Topic]]");
    writeText(dailyPath, "# Daily Log\n\nrecent line");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(cwd) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("[[Topic]]");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("recent line");
  });

  it("falls back to yesterday log when today log missing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const dailyPath = buildDailyFilePath(vaultPath, "ai-knowledge", yesterday());

    writeText(dailyPath, "# Daily Log\n\nyesterday line");

    const result = runScript("session-start.js", {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("yesterday line");
  });

  it("uses empty placeholders when KB files are missing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("session-start.js", {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "(empty - no articles compiled yet)",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain("(no recent daily log)");
  });

  it("uses hot.md when present and non-empty, applies 5000 char limit", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const configPath = path.join(cwd, "memory-mason.json");
    const hotPath = buildHotCachePath(vaultPath, subfolder);
    const indexPath = buildKnowledgeIndexPath(vaultPath, subfolder);

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(hotPath, `HOT_SENTINEL ${"x".repeat(5100)}`);
    writeText(indexPath, "INDEX_SENTINEL");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(cwd) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("HOT_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("INDEX_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("## Hot Cache");
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("## Knowledge Base Index");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("...(truncated)");
  });

  it("falls back to index.md when hot.md is empty", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const configPath = path.join(cwd, "memory-mason.json");
    const hotPath = buildHotCachePath(vaultPath, subfolder);
    const indexPath = buildKnowledgeIndexPath(vaultPath, subfolder);

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(hotPath, "");
    writeText(indexPath, `INDEX_SENTINEL ${"x".repeat(200)}`);

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(cwd) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("INDEX_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("HOT_SENTINEL");
  });

  it("falls back to index.md when hot.md is missing", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const configPath = path.join(cwd, "memory-mason.json");
    const indexPath = buildKnowledgeIndexPath(vaultPath, subfolder);

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(indexPath, `INDEX_SENTINEL ${"x".repeat(200)}`);

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(cwd) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("INDEX_SENTINEL");
  });

  it("includes both hot.md content and recent daily log when both present", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const configPath = path.join(cwd, "memory-mason.json");
    const hotPath = buildHotCachePath(vaultPath, subfolder);
    const dailyPath = buildDailyFilePath(vaultPath, subfolder, today());

    writeText(configPath, JSON.stringify({ vaultPath, subfolder }));
    writeText(hotPath, `HOT_SENTINEL ${"y".repeat(40)}`);
    writeText(dailyPath, "# Daily Log\n\nDAILY_SENTINEL");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(cwd) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("HOT_SENTINEL");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("DAILY_SENTINEL");
  });

  it("uses global config fallback when project config and env var are absent", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const dailyPath = buildDailyFilePath(vaultPath, "global-brain", today());

    writeText(
      path.join(homeDir, ".memory-mason", "config.json"),
      JSON.stringify({ vaultPath, subfolder: "global-brain" }),
    );
    writeText(dailyPath, "# Daily Log\n\nfrom global config");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(homeDir) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("from global config");
  });

  it("uses .env fallback when project config and env var are absent", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const dailyPath = buildDailyFilePath(vaultPath, "dotenv-brain", today());

    writeText(
      path.join(cwd, ".env"),
      `MEMORY_MASON_VAULT_PATH=${vaultPath}\nMEMORY_MASON_SUBFOLDER=dotenv-brain`,
    );
    writeText(dailyPath, "# Daily Log\n\nfrom dotenv config");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(homeDir) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("from dotenv config");
  });

  it("reports invalid stdin to stderr", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("session-start.js", {
      stdinText: "{not-json",
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
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
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    vi.spyOn(sessionStart, "resolveRuntimeConfig").mockReturnValue({
      vaultPath,
      subfolder: "ai-knowledge",
      sync: false,
    });

    const existsSyncSpy = vi.spyOn(fs, "existsSync");
    const statSyncSpy = vi.spyOn(fs, "statSync");
    const readdirSyncSpy = vi.spyOn(fs, "readdirSync");
    const readFileSyncSpy = vi.spyOn(fs, "readFileSync");

    const result = runScript("session-start.js", {
      payload: { cwd: hooksRoot, hookEventName: "SessionStart" },
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
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const indexPath = buildKnowledgeIndexPath(vaultPath, subfolder);
    const dailyPath = buildDailyFilePath(vaultPath, subfolder, today());

    writeText(indexPath, "# Index\n\nSYNC_TRUE_INDEX_SENTINEL");
    writeText(dailyPath, "# Daily Log\n\nSYNC_TRUE_DAILY_SENTINEL");

    vi.spyOn(sessionStart, "resolveRuntimeConfig").mockReturnValue({
      vaultPath,
      subfolder,
      sync: true,
    });

    const readFileSyncSpy = vi.spyOn(fs, "readFileSync");

    const result = runScript("session-start.js", {
      payload: { cwd: hooksRoot, hookEventName: "SessionStart" },
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
    const payload = JSON.stringify({ cwd: "/tmp", hookEventName: "SessionStart" });
    const payloadBuffer = Buffer.from(payload, "utf-8");
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
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const cwd = createTempDir("mm-cwd-");
    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }),
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
    const homeDir = createTempDir("mm-home-");
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
      cwd: createTempDir("mm-fb-"),
      env: buildEnv(homeDir),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain(
      "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });

  it("uses io fallback functions when stdout/stderr not provided", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
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
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      homedir: homeDir,
    });
    expect(result.status).toBe(0);
    expect(exitCode).toBe(0);
  });
});

describe("session-start.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = sessionStart.run(JSON.stringify({ cwd: createTempDir("mm-cwd-") }), {
      env: null,
      cwd: 123,
      homedir: 42,
    });
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = sessionStart.run(JSON.stringify({}), {
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      cwd: createTempDir("mm-fb-cwd-"),
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
