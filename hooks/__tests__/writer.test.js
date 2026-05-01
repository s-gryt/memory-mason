"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildDailyFilePath,
  buildDailyHeader,
  buildDailyFolderPath,
  buildDailyChunkPath,
  buildDailyMetaPath,
  buildChunkHeader,
} = require("../lib/vault");
const { tryObsidianCli, appendToDaily } = require("../lib/writer");

const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";

const createTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const seedChunkedDay = (vaultPath, subfolder, today, existingContent = "") => {
  const folderPath = buildDailyFolderPath(vaultPath, subfolder, today);
  const chunkPath = buildDailyChunkPath(vaultPath, subfolder, today, 1);
  const metaPath = buildDailyMetaPath(vaultPath, subfolder, today);
  const chunkText = buildChunkHeader(today, 1) + existingContent;

  fs.mkdirSync(folderPath, { recursive: true });
  fs.writeFileSync(chunkPath, chunkText, "utf-8");
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        chunks: [
          {
            id: "001",
            file: "001.md",
            sizeBytes: Buffer.byteLength(chunkText, "utf-8"),
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );

  return {
    folderPath,
    chunkPath,
    chunkText,
  };
};

afterEach(() => {
  delete require.cache[require.resolve("../lib/writer")];
});

describe("tryObsidianCli", () => {
  it("returns false when obsidian command is not available", () => {
    const originalPath = process.env[pathKey];
    process.env[pathKey] = "";

    try {
      expect(tryObsidianCli(["--version"])).toBe(false);
    } finally {
      process.env[pathKey] = originalPath;
    }
  });

  it("returns true when obsidian shim runs node --version successfully", () => {
    const tempDir = createTempDir("memory-mason-obsidian-");
    const shimPath =
      process.platform === "win32"
        ? path.join(tempDir, "obsidian.cmd")
        : path.join(tempDir, "obsidian");
    const shimContent =
      process.platform === "win32" ? "@echo off\r\nnode %*\r\n" : '#!/usr/bin/env sh\nnode "$@"\n';
    fs.writeFileSync(shimPath, shimContent, "utf-8");

    if (process.platform !== "win32") {
      fs.chmodSync(shimPath, 0o755);
    }

    const originalPath = process.env[pathKey];
    process.env[pathKey] =
      tempDir + path.delimiter + (typeof originalPath === "string" ? originalPath : "");

    try {
      expect(tryObsidianCli(["--version"])).toBe(true);
    } finally {
      process.env[pathKey] = originalPath;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the direct obsidian command on non-Windows platforms", () => {
    const calls = [];
    const spawnSync = (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, error: null };
    };

    expect(tryObsidianCli(["--version"], { platform: "linux", spawnSync, cwd: "/tmp/vault" })).toBe(
      true,
    );
    expect(calls).toEqual([
      {
        command: "obsidian",
        args: ["--version"],
        options: {
          encoding: "utf-8",
          timeout: 8000,
          cwd: "/tmp/vault",
        },
      },
    ]);
  });

  it("uses cmd.exe wrapper on Windows platforms", () => {
    const calls = [];
    const spawnSync = (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, error: null };
    };

    expect(
      tryObsidianCli(["--version"], { platform: "win32", spawnSync, cwd: "C:/tmp/vault" }),
    ).toBe(true);
    expect(calls).toEqual([
      {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", "obsidian", "--version"],
        options: {
          encoding: "utf-8",
          timeout: 8000,
          windowsHide: true,
          cwd: "C:/tmp/vault",
        },
      },
    ]);
  });
});

describe("appendToDaily", () => {
  it("creates chunked daily files when day does not exist", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const today = "2026-04-26";
    const content = "\n**[12:00:00] Write**\nhello\n";

    try {
      appendToDaily(vaultPath, subfolder, today, content);
      const folderPath = buildDailyFolderPath(vaultPath, subfolder, today);
      const chunkPath = buildDailyChunkPath(vaultPath, subfolder, today, 1);
      const flatPath = buildDailyFilePath(vaultPath, subfolder, today);

      expect(fs.existsSync(folderPath)).toBe(true);
      expect(fs.statSync(folderPath).isDirectory()).toBe(true);
      expect(fs.existsSync(chunkPath)).toBe(true);
      expect(fs.existsSync(flatPath)).toBe(false);
      expect(fs.readFileSync(chunkPath, "utf-8")).toBe(buildChunkHeader(today, 1) + content);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it("throws when content is not a string", () => {
    expect(() => appendToDaily("/tmp/vault", "ai-knowledge", "2026-04-26", null)).toThrow(
      "content must be a string",
    );
  });

  it("appends to existing daily file without duplicating header", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const today = "2026-04-26";
    const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
    const existingContent = `${buildDailyHeader(today)}\n**[11:00:00] Edit**\nfirst\n`;

    fs.mkdirSync(path.dirname(dailyPath), { recursive: true });
    fs.writeFileSync(dailyPath, existingContent, "utf-8");

    try {
      const newContent = "\n**[12:00:00] Write**\nsecond\n";
      appendToDaily(vaultPath, subfolder, today, newContent);

      const updated = fs.readFileSync(dailyPath, "utf-8");
      expect(updated).toBe(existingContent + newContent);
      expect(updated.split("# Daily Log").length - 1).toBe(1);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it("does not corrupt content containing special JSON characters", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const today = "2026-04-26";
    const sqlContent =
      "\n**[12:00:00] AssistantReply**\nSELECT * FROM foo WHERE id IN ('a', 'b'] AND x = \"y\";\n";

    try {
      appendToDaily(vaultPath, subfolder, today, sqlContent);

      const chunkPath = buildDailyChunkPath(vaultPath, subfolder, today, 1);
      expect(fs.readFileSync(chunkPath, "utf-8")).toContain("SELECT * FROM foo");
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});

describe("appendToDaily - routing", () => {
  it("routes to flat append when flat file exists", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const today = "2026-04-26";
    const flatPath = buildDailyFilePath(vaultPath, subfolder, today);
    const existingFlat = `${buildDailyHeader(today)}\n**[11:00:00] Edit**\nfirst\n`;
    const appended = "\n**[12:00:00] Write**\nsecond\n";

    fs.mkdirSync(path.dirname(flatPath), { recursive: true });
    fs.writeFileSync(flatPath, existingFlat, "utf-8");

    try {
      appendToDaily(vaultPath, subfolder, today, appended);
      expect(fs.readFileSync(flatPath, "utf-8")).toBe(existingFlat + appended);
      expect(fs.existsSync(buildDailyFolderPath(vaultPath, subfolder, today))).toBe(false);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it("routes to chunked when folder exists", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const today = "2026-04-26";
    const existingChunkBody = "\n**[11:00:00] Edit**\nfirst\n";
    const appended = "\n**[12:00:00] Write**\nsecond\n";

    const seeded = seedChunkedDay(vaultPath, subfolder, today, existingChunkBody);

    try {
      appendToDaily(vaultPath, subfolder, today, appended);
      expect(fs.readFileSync(seeded.chunkPath, "utf-8")).toBe(seeded.chunkText + appended);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it("routes to chunked when neither exists (new default)", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const today = "2026-04-26";
    const content = "\n**[12:00:00] Write**\nhello\n";
    const folderPath = buildDailyFolderPath(vaultPath, subfolder, today);
    const chunkPath = buildDailyChunkPath(vaultPath, subfolder, today, 1);

    try {
      appendToDaily(vaultPath, subfolder, today, content);

      expect(fs.existsSync(folderPath)).toBe(true);
      expect(fs.statSync(folderPath).isDirectory()).toBe(true);
      expect(fs.existsSync(chunkPath)).toBe(true);
      expect(fs.readFileSync(chunkPath, "utf-8")).toBe(buildChunkHeader(today, 1) + content);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it("prefers chunked when folder and flat file both exist", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const subfolder = "ai-knowledge";
    const today = "2026-04-26";
    const flatPath = buildDailyFilePath(vaultPath, subfolder, today);
    const existingFlat = `${buildDailyHeader(today)}\n**[11:00:00] Edit**\nflat\n`;
    const existingChunkBody = "\n**[11:30:00] Edit**\nchunk\n";
    const appended = "\n**[12:00:00] Write**\nsecond\n";

    const seeded = seedChunkedDay(vaultPath, subfolder, today, existingChunkBody);
    fs.mkdirSync(path.dirname(flatPath), { recursive: true });
    fs.writeFileSync(flatPath, existingFlat, "utf-8");

    try {
      appendToDaily(vaultPath, subfolder, today, appended);

      expect(fs.readFileSync(seeded.chunkPath, "utf-8")).toBe(seeded.chunkText + appended);
      expect(fs.readFileSync(flatPath, "utf-8")).toBe(existingFlat);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});
