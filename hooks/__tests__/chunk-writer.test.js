"use strict";

const path = require("node:path");
const vaultModule = require("../lib/vault");

const padChunkId = (chunkNum) => String(chunkNum).padStart(3, "0");

const buildDailyFolderPathMock = (vaultPath, subfolder, today) =>
  path.join(vaultPath, subfolder, "daily", today);

const buildDailyChunkPathMock = (vaultPath, subfolder, today, chunkNum) =>
  path.join(buildDailyFolderPathMock(vaultPath, subfolder, today), `${padChunkId(chunkNum)}.md`);

const buildDailyIndexPathMock = (vaultPath, subfolder, today) =>
  path.join(buildDailyFolderPathMock(vaultPath, subfolder, today), "index.md");

const buildChunkHeaderMock = (today, chunkNum) =>
  `# Daily Log: ${today} (chunk ${padChunkId(chunkNum)})\n\n`;

const buildChunkIndexContentMock = (today, chunkCount) => {
  const chunkLinks = Array.from(
    { length: chunkCount },
    (_, index) => `- [[${padChunkId(index + 1)}]]`,
  );
  return [`# Daily Index: ${today}`, ""].concat(chunkLinks).join("\n");
};

const chunkVaultExportNames = [
  "buildDailyFolderPath",
  "buildDailyChunkPath",
  "buildDailyIndexPath",
  "buildChunkHeader",
  "buildChunkIndexContent",
];

const originalVaultState = Object.fromEntries(
  chunkVaultExportNames.map((exportName) => [
    exportName,
    {
      hadOwnProperty: Object.hasOwn(vaultModule, exportName),
      value: vaultModule[exportName],
    },
  ]),
);

Object.assign(vaultModule, {
  buildDailyFolderPath: buildDailyFolderPathMock,
  buildDailyChunkPath: buildDailyChunkPathMock,
  buildDailyIndexPath: buildDailyIndexPathMock,
  buildChunkHeader: buildChunkHeaderMock,
  buildChunkIndexContent: buildChunkIndexContentMock,
});

const {
  loadMeta,
  saveMeta,
  getCurrentChunk,
  needsNewChunk,
  nextChunkNum,
  buildChunkEntry,
  appendToChunked,
} = require("../lib/chunk-writer");

const makeChunk = (chunkNum, sizeBytes, createdAt = "2026-04-30T00:00:00.000Z") => {
  const id = padChunkId(chunkNum);
  return {
    id,
    file: `${id}.md`,
    sizeBytes,
    createdAt,
  };
};

const makeFsApi = (initialFiles = {}) => {
  const files = { ...initialFiles };
  const mkdirCalls = [];
  const writeCalls = [];
  const appendCalls = [];

  const hasPath = (p) => Object.hasOwn(files, p);

  return {
    existsSync: (p) => hasPath(p),
    statSync: (p) => {
      if (!hasPath(p)) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }

      return {
        isDirectory: () => files[p] === null,
        isFile: () => typeof files[p] === "string",
      };
    },
    readdirSync: (p) => {
      const prefix = p.endsWith(path.sep) ? p : p + path.sep;
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix) && k.slice(prefix.length).indexOf(path.sep) === -1)
        .map((k) => k.slice(prefix.length))
        .filter((k) => k !== "");
    },
    mkdirSync: (p) => {
      mkdirCalls.push(p);
      if (!hasPath(p)) {
        files[p] = null;
      }
    },
    readFileSync: (p) => {
      if (!hasPath(p)) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return files[p];
    },
    writeFileSync: (p, data) => {
      writeCalls.push({ path: p, data });
      files[p] = data;
    },
    appendFileSync: (p, data) => {
      appendCalls.push({ path: p, data });
      files[p] = (hasPath(p) && typeof files[p] === "string" ? files[p] : "") + data;
    },
    _files: files,
    _mkdirCalls: mkdirCalls,
    _writeCalls: writeCalls,
    _appendCalls: appendCalls,
  };
};

const makeChunkPaths = () => {
  const vaultPath = path.join("vault-root");
  const subfolder = "ai-knowledge";
  const today = "2026-04-30";
  const folderPath = buildDailyFolderPathMock(vaultPath, subfolder, today);
  const indexPath = buildDailyIndexPathMock(vaultPath, subfolder, today);
  const metaPath = path.join(folderPath, "meta.json");
  const firstChunkPath = buildDailyChunkPathMock(vaultPath, subfolder, today, 1);
  const secondChunkPath = buildDailyChunkPathMock(vaultPath, subfolder, today, 2);

  return {
    vaultPath,
    subfolder,
    today,
    folderPath,
    indexPath,
    metaPath,
    firstChunkPath,
    secondChunkPath,
  };
};

const runFirstWrite = (content = "first") => {
  const paths = makeChunkPaths();
  const fsApi = makeFsApi({});
  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, content, {
    capBytes: 512000,
    fsApi,
  });
  return {
    ...paths,
    fsApi,
    content,
  };
};

const runSecondWriteWithoutRotation = () => {
  const paths = makeChunkPaths();
  const fsApi = makeFsApi({});
  const firstContent = "first";
  const secondContent = "second";

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, firstContent, {
    capBytes: 512000,
    fsApi,
  });
  const beforeMeta = JSON.parse(fsApi._files[paths.metaPath]);
  const createdAtBefore = beforeMeta.chunks[0].createdAt;

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, secondContent, {
    capBytes: 512000,
    fsApi,
  });

  return {
    ...paths,
    fsApi,
    firstContent,
    secondContent,
    createdAtBefore,
  };
};

const runRotationWrite = () => {
  const paths = makeChunkPaths();
  const fsApi = makeFsApi({});
  const firstContent = "x";
  const secondContent = "y";

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, firstContent, {
    capBytes: 512000,
    fsApi,
  });
  const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
  const capBytes = firstMeta.chunks[0].sizeBytes;

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, secondContent, {
    capBytes,
    fsApi,
  });

  return {
    ...paths,
    fsApi,
    firstContent,
    secondContent,
    capBytes,
  };
};

afterAll(() => {
  chunkVaultExportNames.forEach((exportName) => {
    const original = originalVaultState[exportName];
    if (!original.hadOwnProperty) {
      delete vaultModule[exportName];
      return;
    }
    vaultModule[exportName] = original.value;
  });
});

describe("loadMeta", () => {
  it("returns default when meta.json missing", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const fsApi = makeFsApi({});
    expect(loadMeta(folderPath, fsApi)).toEqual({ chunks: [] });
  });

  it("parses valid meta.json", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const meta = {
      chunks: [makeChunk(1, 20), makeChunk(2, 40)],
    };
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify(meta),
    });

    const result = loadMeta(folderPath, fsApi);
    expect(result).toEqual(meta);
    expect(result.chunks).not.toBe(meta.chunks);
    expect(result.chunks[0]).not.toBe(meta.chunks[0]);
  });

  it("returns default on SyntaxError", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: "{not valid json",
    });

    expect(loadMeta(folderPath, fsApi)).toEqual({ chunks: [] });
  });

  it("throws on structurally invalid meta.json", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({ invalid: true }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "meta.json must contain an object with chunks array",
    );
  });

  it("throws when chunk ids are non-contiguous", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [makeChunk(1, 1), makeChunk(3, 1)],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "chunk ids must be contiguous starting at 001",
    );
  });

  it("throws when parsed meta root is an array", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: "[]",
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "meta.json must contain an object with chunks array",
    );
  });

  it("throws when chunk id format is invalid", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: "1",
            file: "001.md",
            sizeBytes: 1,
            createdAt: "2026-04-30T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk id must match 3-digit format");
  });

  it("throws when chunk file format is invalid", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: "001",
            file: "chunk.md",
            sizeBytes: 1,
            createdAt: "2026-04-30T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk file must match 3-digit .md format");
  });

  it("throws when chunk file does not match chunk id", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: "001",
            file: "002.md",
            sizeBytes: 1,
            createdAt: "2026-04-30T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk file must match chunk id");
  });

  it("throws when chunk sizeBytes is invalid", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: "001",
            file: "001.md",
            sizeBytes: -1,
            createdAt: "2026-04-30T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "chunk sizeBytes must be a non-negative integer",
    );
  });

  it("throws when chunk createdAt is invalid", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: "001",
            file: "001.md",
            sizeBytes: 1,
            createdAt: "not-iso",
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "chunk createdAt must be a valid ISO timestamp",
    );
  });

  it("throws when chunk entry is not an object", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [null],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk id must match 3-digit format");
  });

  it("rethrows non-ENOENT read errors", () => {
    const fsApi = makeFsApi({});
    fsApi.readFileSync = () => {
      const error = new Error("EACCES");
      error.code = "EACCES";
      throw error;
    };

    expect(() => loadMeta(path.join("vault", "daily", "2026-04-30"), fsApi)).toThrow("EACCES");
  });

  it("rethrows non-SyntaxError JSON parse failures", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({ chunks: [] }),
    });
    const originalParse = JSON.parse;
    JSON.parse = () => {
      throw new TypeError("parse failed");
    };

    try {
      expect(() => loadMeta(folderPath, fsApi)).toThrow("parse failed");
    } finally {
      JSON.parse = originalParse;
    }
  });
});

describe("saveMeta", () => {
  it("writes 2-space indented JSON", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const metaPath = path.join(folderPath, "meta.json");
    const meta = { chunks: [makeChunk(1, 12)] };
    const fsApi = makeFsApi({});

    saveMeta(folderPath, meta, fsApi);

    expect(fsApi._files[metaPath]).toBe(JSON.stringify(meta, null, 2));
  });

  it("creates directory if missing", () => {
    const folderPath = path.join("vault", "daily", "2026-04-30");
    const fsApi = makeFsApi({});

    saveMeta(folderPath, { chunks: [makeChunk(1, 5)] }, fsApi);

    expect(fsApi._mkdirCalls).toContain(folderPath);
    expect(fsApi._files[folderPath]).toBe(null);
  });

  it("throws on invalid meta shape", () => {
    const fsApi = makeFsApi({});

    expect(() =>
      saveMeta(path.join("vault", "daily", "2026-04-30"), { chunks: "invalid" }, fsApi),
    ).toThrow("meta.json must contain an object with chunks array");
  });
});

describe("getCurrentChunk", () => {
  it("returns null for empty chunks array", () => {
    expect(getCurrentChunk({ chunks: [] })).toBe(null);
  });

  it("returns last element for populated array", () => {
    expect(getCurrentChunk({ chunks: [makeChunk(1, 5), makeChunk(2, 6)] })).toEqual(
      makeChunk(2, 6),
    );
  });

  it("accepts meta objects with null prototype", () => {
    const meta = Object.create(null);
    meta.chunks = [];
    expect(getCurrentChunk(meta)).toBe(null);
  });
});

describe("needsNewChunk", () => {
  it("returns true when currentChunk is null", () => {
    expect(needsNewChunk(null, 1, 2)).toBe(true);
  });

  it("returns true when would exceed cap", () => {
    expect(needsNewChunk({ sizeBytes: 5 }, 6, 10)).toBe(true);
  });

  it("returns false when exactly at cap", () => {
    expect(needsNewChunk({ sizeBytes: 5 }, 5, 10)).toBe(false);
  });

  it("returns false when below cap", () => {
    expect(needsNewChunk({ sizeBytes: 5 }, 4, 10)).toBe(false);
  });

  it("throws on invalid contentByteLength", () => {
    expect(() => needsNewChunk({ sizeBytes: 1 }, -1, 10)).toThrow(
      "contentByteLength must be a non-negative integer",
    );
  });

  it("throws on invalid capBytes", () => {
    expect(() => needsNewChunk({ sizeBytes: 1 }, 1, 0)).toThrow(
      "capBytes must be a positive integer",
    );
  });
});

describe("nextChunkNum", () => {
  it("returns 1 for empty meta", () => {
    expect(nextChunkNum({ chunks: [] })).toBe(1);
  });

  it("returns N+1 for meta with N chunks", () => {
    expect(nextChunkNum({ chunks: [makeChunk(1, 1), makeChunk(2, 1)] })).toBe(3);
  });

  it("throws when chunk count would exceed 999", () => {
    const chunks = Array.from({ length: 999 }, (_, index) => makeChunk(index + 1, 1));
    expect(() => nextChunkNum({ chunks })).toThrow("chunk count exceeds 999");
  });
});

describe("buildChunkEntry", () => {
  it("has padded id and file", () => {
    const entry = buildChunkEntry(7, 99);
    expect(entry.id).toBe("007");
    expect(entry.file).toBe("007.md");
  });

  it("records sizeBytes", () => {
    const entry = buildChunkEntry(1, 123);
    expect(entry.sizeBytes).toBe(123);
  });

  it("has ISO createdAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:34:56.789Z"));

    try {
      const entry = buildChunkEntry(1, 1);
      expect(entry.createdAt).toBe("2026-04-30T12:34:56.789Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws on chunkNum 1000", () => {
    expect(() => buildChunkEntry(1000, 1)).toThrow("chunkNum must be an integer from 1 to 999");
  });

  it("throws on invalid sizeBytes", () => {
    expect(() => buildChunkEntry(1, -1)).toThrow("sizeBytes must be a non-negative integer");
  });
});

describe("appendToChunked - first write", () => {
  it("creates folder via mkdirSync", () => {
    const { fsApi, folderPath } = runFirstWrite("alpha");
    expect(fsApi._mkdirCalls).toContain(folderPath);
  });

  it("writes 001.md with chunk header prepended", () => {
    const { fsApi, firstChunkPath, today } = runFirstWrite("alpha");
    expect(fsApi._files[firstChunkPath]).toBe(`${buildChunkHeaderMock(today, 1)}alpha`);
  });

  it("creates meta.json with one chunk entry", () => {
    const { fsApi, metaPath } = runFirstWrite("alpha");
    const meta = JSON.parse(fsApi._files[metaPath]);
    expect(meta.chunks).toHaveLength(1);
    expect(meta.chunks[0].id).toBe("001");
    expect(meta.chunks[0].file).toBe("001.md");
  });

  it("creates index.md", () => {
    const { fsApi, indexPath, today } = runFirstWrite("alpha");
    expect(fsApi._files[indexPath]).toBe(buildChunkIndexContentMock(today, 1));
  });

  it("stores actual file byte size including header", () => {
    const { fsApi, firstChunkPath, metaPath } = runFirstWrite("alpha");
    const chunkText = fsApi._files[firstChunkPath];
    const meta = JSON.parse(fsApi._files[metaPath]);
    expect(meta.chunks[0].sizeBytes).toBe(Buffer.byteLength(chunkText, "utf-8"));
  });
});

describe("appendToChunked - second write same chunk", () => {
  it("appends to 001.md", () => {
    const { fsApi, firstChunkPath, firstContent, secondContent, today } =
      runSecondWriteWithoutRotation();
    expect(fsApi._files[firstChunkPath]).toBe(
      buildChunkHeaderMock(today, 1) + firstContent + secondContent,
    );
  });

  it("updates meta sizeBytes", () => {
    const { fsApi, firstChunkPath, metaPath } = runSecondWriteWithoutRotation();
    const meta = JSON.parse(fsApi._files[metaPath]);
    expect(meta.chunks[0].sizeBytes).toBe(Buffer.byteLength(fsApi._files[firstChunkPath], "utf-8"));
  });

  it("does not create 002.md", () => {
    const { fsApi, secondChunkPath } = runSecondWriteWithoutRotation();
    expect(fsApi.existsSync(secondChunkPath)).toBe(false);
  });

  it("preserves createdAt for existing chunk", () => {
    const { fsApi, metaPath, createdAtBefore } = runSecondWriteWithoutRotation();
    const meta = JSON.parse(fsApi._files[metaPath]);
    expect(meta.chunks[0].createdAt).toBe(createdAtBefore);
  });
});

describe("appendToChunked - rotation triggered", () => {
  it("creates 002.md with chunk header", () => {
    const { fsApi, secondChunkPath, today, secondContent } = runRotationWrite();
    expect(fsApi._files[secondChunkPath]).toBe(buildChunkHeaderMock(today, 2) + secondContent);
  });

  it("meta has two chunk entries", () => {
    const { fsApi, metaPath } = runRotationWrite();
    const meta = JSON.parse(fsApi._files[metaPath]);
    expect(meta.chunks).toHaveLength(2);
    expect(meta.chunks[1].id).toBe("002");
  });

  it("index.md updated with both chunks", () => {
    const { fsApi, indexPath, today } = runRotationWrite();
    expect(fsApi._files[indexPath]).toBe(buildChunkIndexContentMock(today, 2));
  });

  it("throws if next chunk file already exists", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: 512000,
      fsApi,
    });

    const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = firstMeta.chunks[0].sizeBytes;
    fsApi.writeFileSync(paths.secondChunkPath, "pre-existing", "utf-8");

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y", { capBytes, fsApi }),
    ).toThrow(`chunk file already exists: ${paths.secondChunkPath}`);
  });
});

describe("appendToChunked - cap boundary", () => {
  it("content exactly at cap stays in same chunk", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: 512000,
      fsApi,
    });
    const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = firstMeta.chunks[0].sizeBytes + Buffer.byteLength("y", "utf-8");

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y", { capBytes, fsApi });

    expect(fsApi.existsSync(paths.secondChunkPath)).toBe(false);
    expect(fsApi._files[paths.firstChunkPath].endsWith("xy")).toBe(true);
  });

  it("content one byte over cap rotates to new chunk", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: 512000,
      fsApi,
    });
    const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = firstMeta.chunks[0].sizeBytes + Buffer.byteLength("y", "utf-8");

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "yz", { capBytes, fsApi });

    expect(fsApi.existsSync(paths.secondChunkPath)).toBe(true);
  });
});

describe("appendToChunked - corruption guards", () => {
  it("throws when folder path exists as a file", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: "not a directory",
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", { fsApi }),
    ).toThrow(`daily folder path is not a directory: ${paths.folderPath}`);
  });

  it("throws when meta.json is missing in a non-empty chunk folder", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.firstChunkPath]: "existing chunk",
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", { fsApi }),
    ).toThrow(`meta.json missing for existing chunk folder: ${paths.folderPath}`);
  });

  it("throws when meta.json is missing and index.md exists in the folder", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.indexPath]: buildChunkIndexContentMock(paths.today, 1),
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", { fsApi }),
    ).toThrow(`meta.json missing for existing chunk folder: ${paths.folderPath}`);
  });

  it("throws when current chunk file is missing", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.metaPath]: JSON.stringify({ chunks: [makeChunk(1, 10)] }),
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", { capBytes: 999, fsApi }),
    ).toThrow(`current chunk file is missing: ${paths.firstChunkPath}`);
  });

  it("throws when current chunk path is not a file", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.metaPath]: JSON.stringify({ chunks: [makeChunk(1, 10)] }),
      [paths.firstChunkPath]: null,
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", { capBytes: 999, fsApi }),
    ).toThrow(`current chunk path is not a file: ${paths.firstChunkPath}`);
  });
});

describe("appendToChunked - validation", () => {
  it("throws on empty vaultPath", () => {
    const fsApi = makeFsApi({});
    expect(() => appendToChunked("", "ai-knowledge", "2026-04-30", "x", { fsApi })).toThrow(
      "vaultPath must be a non-empty string",
    );
  });

  it("throws on empty subfolder", () => {
    const fsApi = makeFsApi({});
    expect(() => appendToChunked("vault", "", "2026-04-30", "x", { fsApi })).toThrow(
      "subfolder must be a non-empty string",
    );
  });

  it("throws on empty today", () => {
    const fsApi = makeFsApi({});
    expect(() => appendToChunked("vault", "ai-knowledge", "", "x", { fsApi })).toThrow(
      "today must be a non-empty string",
    );
  });

  it("throws on non-string content", () => {
    const fsApi = makeFsApi({});
    expect(() => appendToChunked("vault", "ai-knowledge", "2026-04-30", 123, { fsApi })).toThrow(
      "content must be a string",
    );
  });

  it("throws on invalid capBytes", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("vault", "ai-knowledge", "2026-04-30", "x", { capBytes: 0, fsApi }),
    ).toThrow("capBytes must be a positive integer");
  });

  it("throws when fsApi does not provide required methods", () => {
    expect(() =>
      appendToChunked("vault", "ai-knowledge", "2026-04-30", "x", { fsApi: {} }),
    ).toThrow("fsApi must provide required sync methods");
  });

  it("uses default fsApi when options is not an object", () => {
    const paths = makeChunkPaths();
    const delegatedFsApi = makeFsApi({});
    const nodeFs = require("node:fs");

    const spies = [
      vi.spyOn(nodeFs, "existsSync").mockImplementation((p) => delegatedFsApi.existsSync(p)),
      vi.spyOn(nodeFs, "statSync").mockImplementation((p) => delegatedFsApi.statSync(p)),
      vi.spyOn(nodeFs, "readdirSync").mockImplementation((p) => delegatedFsApi.readdirSync(p)),
      vi
        .spyOn(nodeFs, "mkdirSync")
        .mockImplementation((p, options) => delegatedFsApi.mkdirSync(p, options)),
      vi
        .spyOn(nodeFs, "readFileSync")
        .mockImplementation((p, encoding) => delegatedFsApi.readFileSync(p, encoding)),
      vi
        .spyOn(nodeFs, "writeFileSync")
        .mockImplementation((p, data, encoding) => delegatedFsApi.writeFileSync(p, data, encoding)),
      vi
        .spyOn(nodeFs, "appendFileSync")
        .mockImplementation((p, data, encoding) =>
          delegatedFsApi.appendFileSync(p, data, encoding),
        ),
    ];

    try {
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", 123);
      expect(delegatedFsApi._files[paths.firstChunkPath]).toBe(
        `${buildChunkHeaderMock(paths.today, 1)}x`,
      );
    } finally {
      spies.forEach((spy) => {
        spy.mockRestore();
      });
    }
  });
});
