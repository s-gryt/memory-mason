"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { migrateFlatToChunked } = require("../lib/migrate-daily");
const {
  buildDailyFilePath,
  buildDailyFolderPath,
  buildDailyIndexPath,
  buildDailyMetaPath,
  buildDailyHeader,
  buildDailyChunkPath,
  buildChunkHeader,
  buildChunkIndexContent,
} = require("../lib/vault");

function makeFsApi(initialFiles = {}) {
  const files = { ...initialFiles };
  return {
    existsSync: (p) => p in files,
    statSync: (p) => ({
      isDirectory: () => files[p] === null,
      isFile: () => typeof files[p] === "string",
    }),
    mkdirSync: (p) => {
      files[p] = null;
    },
    readFileSync: (p) => {
      if (!(p in files)) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return files[p];
    },
    writeFileSync: (p, data) => {
      files[p] = data;
    },
    _files: files,
  };
}

function makePaths(dateIso = "2026-04-30") {
  const vaultPath = path.join("vault-root");
  const subfolder = "ai-knowledge";
  return {
    vaultPath,
    subfolder,
    dateIso,
    flatPath: buildDailyFilePath(vaultPath, subfolder, dateIso),
    folderPath: buildDailyFolderPath(vaultPath, subfolder, dateIso),
    indexPath: buildDailyIndexPath(vaultPath, subfolder, dateIso),
    metaPath: buildDailyMetaPath(vaultPath, subfolder, dateIso),
  };
}

function sessionHeader(dateIso, time, sessionId = "session", source = "copilot") {
  return `## Session [${dateIso}T${time}Z] ${sessionId} / ${source}\n`;
}

function runCommit(sourceText, options = {}) {
  const paths = makePaths();
  const fsApi = makeFsApi({ [paths.flatPath]: sourceText });
  const result = migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
    commit: true,
    fsApi,
    ...options,
  });
  return { paths, fsApi, result, sourceText };
}

describe("migrateFlatToChunked - dry run", () => {
  it("returns correct stats without writing any files", () => {
    const paths = makePaths();
    const sourceText = `prefix\n${sessionHeader(paths.dateIso, "10:00:00")}first\n`;
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });
    const before = { ...fsApi._files };

    const result = migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
      commit: false,
      capBytes: 1,
      fsApi,
    });

    expect(result).toEqual({
      chunksCreated: 2,
      bytesProcessed: Buffer.byteLength(sourceText, "utf-8"),
      originalPath: paths.flatPath,
      folderPath: paths.folderPath,
      dryRun: true,
    });
    expect(fsApi._files).toEqual(before);
  });

  it("chunksCreated reflects expected split count", () => {
    const paths = makePaths();
    const sourceText =
      "preamble\n" +
      sessionHeader(paths.dateIso, "10:00:00", "s1") +
      "alpha\n" +
      sessionHeader(paths.dateIso, "11:00:00", "s2") +
      "beta\n";
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });

    const result = migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
      commit: false,
      capBytes: 1,
      fsApi,
    });

    expect(result.chunksCreated).toBe(3);
  });

  it("dryRun flag is true in return value", () => {
    const paths = makePaths();
    const sourceText = "no sessions here\n";
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });

    const result = migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, { fsApi });

    expect(result.dryRun).toBe(true);
  });

  it("accepts options objects with null prototype", () => {
    const paths = makePaths();
    const sourceText = "no sessions here\n";
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });
    const options = Object.create(null);
    options.fsApi = fsApi;

    const result = migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, options);

    expect(result.dryRun).toBe(true);
  });

  it("uses default fsApi when omitted", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-mason-migrate-"));
    const subfolder = "ai-knowledge";
    const dateIso = "2026-04-30";
    const flatPath = buildDailyFilePath(tempRoot, subfolder, dateIso);
    const sourceText = "plain text\n";

    fs.mkdirSync(path.dirname(flatPath), { recursive: true });
    fs.writeFileSync(flatPath, sourceText, "utf-8");

    try {
      const result = migrateFlatToChunked(tempRoot, subfolder, dateIso, {
        commit: false,
        capBytes: 512000,
      });
      expect(result.dryRun).toBe(true);
      expect(result.bytesProcessed).toBe(Buffer.byteLength(sourceText, "utf-8"));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps multiple blocks in one chunk when cap allows", () => {
    const paths = makePaths();
    const sourceText = `preamble\n${sessionHeader(paths.dateIso, "10:00:00", "s1")}alpha\n`;
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });

    const result = migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
      commit: false,
      capBytes: 512000,
      fsApi,
    });

    expect(result.chunksCreated).toBe(1);
  });
});

describe("migrateFlatToChunked - single block file", () => {
  it("creates one chunk with all content", () => {
    const { paths, fsApi, result, sourceText } = runCommit(
      "single block\nwithout session header\n",
    );
    const firstChunkPath = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 1);

    expect(result.chunksCreated).toBe(1);
    expect(fsApi._files[firstChunkPath]).toBe(buildChunkHeader(paths.dateIso, 1) + sourceText);
  });
});

describe("migrateFlatToChunked - multi-session file", () => {
  it("splits at real session headers", () => {
    const { paths, fsApi, result } = runCommit(
      "preface\n" +
        sessionHeader("2026-04-30", "09:00:00", "s1") +
        "first\n" +
        sessionHeader("2026-04-30", "10:00:00", "s2") +
        "second\n",
      { capBytes: 1 },
    );
    const chunk1Path = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 1);
    const chunk2Path = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 2);
    const chunk3Path = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 3);

    expect(result.chunksCreated).toBe(3);
    expect(fsApi._files[chunk1Path]).toBe(`${buildChunkHeader(paths.dateIso, 1)}preface\n`);
    expect(fsApi._files[chunk2Path]).toBe(
      buildChunkHeader(paths.dateIso, 2) +
        sessionHeader(paths.dateIso, "09:00:00", "s1") +
        "first\n",
    );
    expect(fsApi._files[chunk3Path]).toBe(
      buildChunkHeader(paths.dateIso, 3) +
        sessionHeader(paths.dateIso, "10:00:00", "s2") +
        "second\n",
    );
  });

  it("does not split at session header inside fenced block", () => {
    const { paths, fsApi, result } = runCommit(
      "intro\n" +
        "```md\n" +
        sessionHeader("2026-04-30", "09:00:00", "fake") +
        "inside\n" +
        "```\n" +
        sessionHeader("2026-04-30", "10:00:00", "real") +
        "outside\n",
      { capBytes: 1 },
    );
    const chunk1Path = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 1);
    const chunk2Path = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 2);

    expect(result.chunksCreated).toBe(2);
    expect(fsApi._files[chunk1Path]).toContain(sessionHeader(paths.dateIso, "09:00:00", "fake"));
    expect(fsApi._files[chunk2Path]).toContain(sessionHeader(paths.dateIso, "10:00:00", "real"));
  });
});

describe("migrateFlatToChunked - commit mode", () => {
  function runTwoChunkCommit() {
    return runCommit(
      sessionHeader("2026-04-30", "10:00:00", "s1") +
        "alpha\n" +
        sessionHeader("2026-04-30", "11:00:00", "s2") +
        "beta\n",
      { capBytes: 1 },
    );
  }

  it("creates folder", () => {
    const { fsApi, paths } = runTwoChunkCommit();
    expect(fsApi._files[paths.folderPath]).toBe(null);
  });

  it("writes all chunk files", () => {
    const { fsApi, paths } = runTwoChunkCommit();
    const chunk1Path = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 1);
    const chunk2Path = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 2);

    expect(typeof fsApi._files[chunk1Path]).toBe("string");
    expect(typeof fsApi._files[chunk2Path]).toBe("string");
  });

  it("writes meta.json", () => {
    const { fsApi, paths } = runTwoChunkCommit();
    const meta = JSON.parse(fsApi._files[paths.metaPath]);

    expect(meta.chunks).toHaveLength(2);
    expect(meta.chunks[0].id).toBe("001");
    expect(meta.chunks[1].file).toBe("002.md");
  });

  it("writes index.md", () => {
    const { fsApi, paths } = runTwoChunkCommit();

    expect(fsApi._files[paths.indexPath]).toBe(buildChunkIndexContent(paths.dateIso, 2));
  });

  it("does not delete source flat file", () => {
    const { fsApi, paths, sourceText } = runTwoChunkCommit();

    expect(paths.flatPath in fsApi._files).toBe(true);
    expect(fsApi._files[paths.flatPath]).toBe(sourceText);
  });
});

describe("migrateFlatToChunked - errors", () => {
  it("throws on missing source file", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({});

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, { fsApi }),
    ).toThrow(`source daily file does not exist: ${paths.flatPath}`);
  });

  it("throws on empty vaultPath", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({ [paths.flatPath]: "x" });

    expect(() => migrateFlatToChunked("", paths.subfolder, paths.dateIso, { fsApi })).toThrow(
      "vaultPath must be a non-empty string",
    );
  });

  it("throws when destination folder already exists in commit mode", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({
      [paths.flatPath]: "content\n",
      [paths.folderPath]: null,
    });

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
        commit: true,
        fsApi,
      }),
    ).toThrow(`chunked daily folder already exists: ${paths.folderPath}`);
  });

  it("throws when source path is not a regular file", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({ [paths.flatPath]: null });

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, { fsApi }),
    ).toThrow(`source daily file is not a regular file: ${paths.flatPath}`);
  });

  it("throws when options is not a plain object", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({ [paths.flatPath]: "content\n" });

    expect(() => migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, [])).toThrow(
      "options must be a plain object",
    );
    expect(paths.flatPath in fsApi._files).toBe(true);
  });

  it("throws when commit is not a boolean", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({ [paths.flatPath]: "content\n" });

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
        commit: "yes",
        fsApi,
      }),
    ).toThrow("options.commit must be a boolean");
  });

  it("throws when capBytes is invalid", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({ [paths.flatPath]: "content\n" });

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
        capBytes: 0,
        fsApi,
      }),
    ).toThrow("capBytes must be a positive integer");
  });

  it("throws when fsApi is missing required methods", () => {
    const paths = makePaths();

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
        fsApi: {},
      }),
    ).toThrow("fsApi must provide required sync methods");
  });

  it("throws when bodyText is not a string", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({ [paths.flatPath]: "content\n" });
    fsApi.readFileSync = () => {
      const value = Buffer.from("content\n", "utf-8");
      value.startsWith = () => false;
      return value;
    };

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
        commit: false,
        fsApi,
      }),
    ).toThrow("bodyText must be a string");
  });

  it("throws when chunk count exceeds 999", () => {
    const paths = makePaths();
    const sourceText = Array.from({ length: 1000 }, (_, index) => {
      const second = String(index % 60).padStart(2, "0");
      return `${sessionHeader(paths.dateIso, `10:00:${second}`, `s${String(index + 1)}`)}entry\n`;
    }).join("");
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });

    expect(() =>
      migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
        capBytes: 1,
        fsApi,
      }),
    ).toThrow("chunk count exceeds 999");
  });

  it("throws when block validation fails", () => {
    const paths = makePaths();
    const fsApi = makeFsApi({ [paths.flatPath]: "content\n" });
    const originalArrayIsArray = Array.isArray;
    Array.isArray = () => false;

    try {
      expect(() =>
        migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
          fsApi,
        }),
      ).toThrow("blocks must be a non-empty array of strings");
    } finally {
      Array.isArray = originalArrayIsArray;
    }
  });
});

describe("migrateFlatToChunked - header and prefix handling", () => {
  it("preserves non-session prefix content in the first chunk", () => {
    const { paths, fsApi } = runCommit(
      `prefix line 1\nprefix line 2\n${sessionHeader("2026-04-30", "12:00:00", "s1")}after\n`,
      { capBytes: 1 },
    );
    const firstChunkPath = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 1);

    expect(fsApi._files[firstChunkPath]).toBe(
      `${buildChunkHeader(paths.dateIso, 1)}prefix line 1\nprefix line 2\n`,
    );
  });

  it("strips the standard flat daily header before writing chunk headers", () => {
    const paths = makePaths();
    const body = "plain body\n";
    const sourceText = buildDailyHeader(paths.dateIso) + body;
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });

    migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
      commit: true,
      fsApi,
    });

    const firstChunkPath = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 1);
    expect(fsApi._files[firstChunkPath]).toBe(buildChunkHeader(paths.dateIso, 1) + body);
  });

  it("creates a header-only chunk for an empty source body", () => {
    const paths = makePaths();
    const sourceText = buildDailyHeader(paths.dateIso);
    const fsApi = makeFsApi({ [paths.flatPath]: sourceText });

    const result = migrateFlatToChunked(paths.vaultPath, paths.subfolder, paths.dateIso, {
      commit: true,
      fsApi,
    });

    const firstChunkPath = buildDailyChunkPath(paths.vaultPath, paths.subfolder, paths.dateIso, 1);
    expect(result.chunksCreated).toBe(1);
    expect(fsApi._files[firstChunkPath]).toBe(buildChunkHeader(paths.dateIso, 1));
  });
});
