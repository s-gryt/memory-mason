"use strict";

const path = require("node:path");
const {
  DEFAULT_DAILY_CHUNK_CAP_BYTES,
  MAX_DAILY_CHUNK_COUNT,
  CHUNK_ID_WIDTH,
} = require("../lib/vault/constants");
const { UTF8_ENCODING } = require("../lib/shared/constants");
const {
  VAULT_RAW_DIR_NAME,
  ROOT_INDEX_FILE_NAME,
  DAILY_META_FILE_NAME,
} = require("../lib/vault/vault-paths");
const vaultModule = require("../lib/vault/vault");
const {
  TEST_DEFAULT_DATE,
  TEST_DEFAULT_DATE_ISO,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
} = require("./helpers/test-constants");

const TWO = 2;
const THREE = 3;
const FOUR = 4;
const FIVE = 5;
const SIX = 6;
const SEVEN = 7;
const TEN = 10;
const TWELVE = 12;
const TWENTY = 20;
const FORTY = 40;
const NINETY_NINE = 99;
const ONE_HUNDRED_TWENTY_THREE = 123;
const ONE_THOUSAND = 1000;
const NEGATIVE_ONE = -1;

const FIRST_CHUNK_ID = "001";
const FIRST_CHUNK_FILE = `${FIRST_CHUNK_ID}.md`;
const SECOND_CHUNK_ID = "002";
const SECOND_CHUNK_FILE = `${SECOND_CHUNK_ID}.md`;
const SEVENTH_CHUNK_ID = "007";
const SEVENTH_CHUNK_FILE = `${SEVENTH_CHUNK_ID}.md`;

const CHUNK_COUNT_EXCEEDS_LIMIT_MESSAGE = `chunk count exceeds ${MAX_DAILY_CHUNK_COUNT}`;
const CHUNK_NUM_RANGE_MESSAGE = `chunkNum must be an integer from 1 to ${MAX_DAILY_CHUNK_COUNT}`;

const padChunkId = (chunkNum) => String(chunkNum).padStart(CHUNK_ID_WIDTH, "0");

const buildDailyFolderPathMock = (vaultPath, subfolder, today) =>
  path.join(vaultPath, subfolder, VAULT_RAW_DIR_NAME, today);

const buildDailyChunkPathMock = (vaultPath, subfolder, today, chunkNum) =>
  path.join(buildDailyFolderPathMock(vaultPath, subfolder, today), `${padChunkId(chunkNum)}.md`);

const buildDailyIndexPathMock = (vaultPath, subfolder, today) =>
  path.join(buildDailyFolderPathMock(vaultPath, subfolder, today), ROOT_INDEX_FILE_NAME);

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
} = require("../lib/vault/chunk-writer");

const makeChunk = (chunkNum, sizeBytes, createdAt = TEST_DEFAULT_DATE_ISO) => {
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
  const subfolder = DEFAULT_SUBFOLDER;
  const today = TEST_DEFAULT_DATE;
  const folderPath = buildDailyFolderPathMock(vaultPath, subfolder, today);
  const indexPath = buildDailyIndexPathMock(vaultPath, subfolder, today);
  const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
  const firstChunkPath = buildDailyChunkPathMock(vaultPath, subfolder, today, 1);
  const secondChunkPath = buildDailyChunkPathMock(vaultPath, subfolder, today, TWO);

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
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
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
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
    fsApi,
  });
  const beforeMeta = JSON.parse(fsApi._files[paths.metaPath]);
  const createdAtBefore = beforeMeta.chunks[0].createdAt;

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, secondContent, {
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
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
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
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

const setupCapBoundaryWrite = () => {
  const paths = makeChunkPaths();
  const fsApi = makeFsApi({});

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
    fsApi,
  });

  const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
  const capBytes = firstMeta.chunks[0].sizeBytes + Buffer.byteLength("y", UTF8_ENCODING);

  return {
    ...paths,
    fsApi,
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
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const fsApi = makeFsApi({});
    expect(loadMeta(folderPath, fsApi)).toEqual({ chunks: [] });
  });

  it("parses valid meta.json", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const meta = {
      chunks: [makeChunk(1, TWENTY), makeChunk(TWO, FORTY)],
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
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: "{not valid json",
    });

    expect(loadMeta(folderPath, fsApi)).toEqual({ chunks: [] });
  });

  it("throws on structurally invalid meta.json", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({ invalid: true }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "meta.json must contain an object with chunks array",
    );
  });

  it("throws when chunk ids are non-contiguous", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [makeChunk(1, 1), makeChunk(THREE, 1)],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "chunk ids must be contiguous starting at 001",
    );
  });

  it("throws when parsed meta root is an array", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: "[]",
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "meta.json must contain an object with chunks array",
    );
  });

  it("throws when chunk id format is invalid", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: "1",
            file: FIRST_CHUNK_FILE,
            sizeBytes: 1,
            createdAt: TEST_DEFAULT_DATE_ISO,
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk id must match 3-digit format");
  });

  it("throws when chunk file format is invalid", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: FIRST_CHUNK_ID,
            file: "chunk.md",
            sizeBytes: 1,
            createdAt: TEST_DEFAULT_DATE_ISO,
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk file must match 3-digit .md format");
  });

  it("throws when chunk file does not match chunk id", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: FIRST_CHUNK_ID,
            file: SECOND_CHUNK_FILE,
            sizeBytes: 1,
            createdAt: TEST_DEFAULT_DATE_ISO,
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk file must match chunk id");
  });

  it("throws when chunk sizeBytes is invalid", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: FIRST_CHUNK_ID,
            file: FIRST_CHUNK_FILE,
            sizeBytes: -1,
            createdAt: TEST_DEFAULT_DATE_ISO,
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "chunk sizeBytes must be a non-negative integer",
    );
  });

  it("throws when chunk createdAt is invalid", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: FIRST_CHUNK_ID,
            file: FIRST_CHUNK_FILE,
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
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
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

    expect(() =>
      loadMeta(path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE), fsApi),
    ).toThrow("EACCES");
  });

  it("rethrows non-SyntaxError JSON parse failures", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
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
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const meta = { chunks: [makeChunk(1, TWELVE)] };
    const fsApi = makeFsApi({});

    saveMeta(folderPath, meta, fsApi);

    expect(fsApi._files[metaPath]).toBe(JSON.stringify(meta, null, TWO));
  });

  it("creates directory if missing", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const fsApi = makeFsApi({});

    saveMeta(folderPath, { chunks: [makeChunk(1, FIVE)] }, fsApi);

    expect(fsApi._mkdirCalls).toContain(folderPath);
    expect(fsApi._files[folderPath]).toBe(null);
  });

  it("throws on invalid meta shape", () => {
    const fsApi = makeFsApi({});

    expect(() =>
      saveMeta(
        path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE),
        { chunks: "invalid" },
        fsApi,
      ),
    ).toThrow("meta.json must contain an object with chunks array");
  });
});

describe("getCurrentChunk", () => {
  it("returns null for empty chunks array", () => {
    expect(getCurrentChunk({ chunks: [] })).toBe(null);
  });

  it("returns last element for populated array", () => {
    expect(getCurrentChunk({ chunks: [makeChunk(1, FIVE), makeChunk(TWO, SIX)] })).toEqual(
      makeChunk(TWO, SIX),
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
    expect(needsNewChunk(null, 1, TWO)).toBe(true);
  });

  it("returns true when would exceed cap", () => {
    expect(needsNewChunk({ sizeBytes: FIVE }, SIX, TEN)).toBe(true);
  });

  it("returns false when exactly at cap", () => {
    expect(needsNewChunk({ sizeBytes: FIVE }, FIVE, TEN)).toBe(false);
  });

  it("returns false when below cap", () => {
    expect(needsNewChunk({ sizeBytes: FIVE }, FOUR, TEN)).toBe(false);
  });

  it("throws on invalid contentByteLength", () => {
    expect(() => needsNewChunk({ sizeBytes: 1 }, NEGATIVE_ONE, TEN)).toThrow(
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
    expect(nextChunkNum({ chunks: [makeChunk(1, 1), makeChunk(TWO, 1)] })).toBe(THREE);
  });

  it("throws when chunk count would exceed MAX_DAILY_CHUNK_COUNT", () => {
    const chunks = Array.from({ length: MAX_DAILY_CHUNK_COUNT }, (_, index) =>
      makeChunk(index + 1, 1),
    );
    expect(() => nextChunkNum({ chunks })).toThrow(CHUNK_COUNT_EXCEEDS_LIMIT_MESSAGE);
  });
});

describe("buildChunkEntry", () => {
  it("has padded id and file", () => {
    const entry = buildChunkEntry(SEVEN, NINETY_NINE);
    expect(entry.id).toBe(SEVENTH_CHUNK_ID);
    expect(entry.file).toBe(SEVENTH_CHUNK_FILE);
  });

  it("records sizeBytes", () => {
    const entry = buildChunkEntry(1, ONE_HUNDRED_TWENTY_THREE);
    expect(entry.sizeBytes).toBe(ONE_HUNDRED_TWENTY_THREE);
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
    expect(() => buildChunkEntry(ONE_THOUSAND, 1)).toThrow(CHUNK_NUM_RANGE_MESSAGE);
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
    expect(meta.chunks[0].id).toBe(FIRST_CHUNK_ID);
    expect(meta.chunks[0].file).toBe(FIRST_CHUNK_FILE);
  });

  it("creates index.md", () => {
    const { fsApi, indexPath, today } = runFirstWrite("alpha");
    expect(fsApi._files[indexPath]).toBe(buildChunkIndexContentMock(today, 1));
  });

  it("stores actual file byte size including header", () => {
    const { fsApi, firstChunkPath, metaPath } = runFirstWrite("alpha");
    const chunkText = fsApi._files[firstChunkPath];
    const meta = JSON.parse(fsApi._files[metaPath]);
    expect(meta.chunks[0].sizeBytes).toBe(Buffer.byteLength(chunkText, UTF8_ENCODING));
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
    expect(meta.chunks[0].sizeBytes).toBe(
      Buffer.byteLength(fsApi._files[firstChunkPath], UTF8_ENCODING),
    );
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
    expect(fsApi._files[secondChunkPath]).toBe(buildChunkHeaderMock(today, TWO) + secondContent);
  });

  it("meta has two chunk entries", () => {
    const { fsApi, metaPath } = runRotationWrite();
    const meta = JSON.parse(fsApi._files[metaPath]);
    expect(meta.chunks).toHaveLength(TWO);
    expect(meta.chunks[1].id).toBe(SECOND_CHUNK_ID);
  });

  it("index.md updated with both chunks", () => {
    const { fsApi, indexPath, today } = runRotationWrite();
    expect(fsApi._files[indexPath]).toBe(buildChunkIndexContentMock(today, TWO));
  });

  it("throws if next chunk file already exists", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
      fsApi,
    });

    const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = firstMeta.chunks[0].sizeBytes;
    fsApi.writeFileSync(paths.secondChunkPath, "pre-existing", UTF8_ENCODING);

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y", { capBytes, fsApi }),
    ).toThrow(`chunk file already exists: ${paths.secondChunkPath}`);
  });
});

describe("appendToChunked - cap boundary", () => {
  it("content exactly at cap stays in same chunk", () => {
    const paths = setupCapBoundaryWrite();
    const { fsApi, capBytes } = paths;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y", { capBytes, fsApi });

    expect(fsApi.existsSync(paths.secondChunkPath)).toBe(false);
    expect(fsApi._files[paths.firstChunkPath].endsWith("xy")).toBe(true);
  });

  it("content one byte over cap rotates to new chunk", () => {
    const paths = setupCapBoundaryWrite();
    const { fsApi, capBytes } = paths;

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
      [paths.metaPath]: JSON.stringify({ chunks: [makeChunk(1, TEN)] }),
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
        capBytes: MAX_DAILY_CHUNK_COUNT,
        fsApi,
      }),
    ).toThrow(`current chunk file is missing: ${paths.firstChunkPath}`);
  });

  it("throws when current chunk path is not a file", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.metaPath]: JSON.stringify({ chunks: [makeChunk(1, TEN)] }),
      [paths.firstChunkPath]: null,
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
        capBytes: MAX_DAILY_CHUNK_COUNT,
        fsApi,
      }),
    ).toThrow(`current chunk path is not a file: ${paths.firstChunkPath}`);
  });
});

describe("appendToChunked - validation", () => {
  it("throws on empty vaultPath", () => {
    const fsApi = makeFsApi({});
    expect(() => appendToChunked("", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, "x", { fsApi })).toThrow(
      "vaultPath must be a non-empty string",
    );
  });

  it("throws on empty subfolder", () => {
    const fsApi = makeFsApi({});
    expect(() => appendToChunked("vault", "", TEST_DEFAULT_DATE, "x", { fsApi })).toThrow(
      "subfolder must be a non-empty string",
    );
  });

  it("throws on empty today", () => {
    const fsApi = makeFsApi({});
    expect(() => appendToChunked("vault", DEFAULT_SUBFOLDER, "", "x", { fsApi })).toThrow(
      "today must be a non-empty string",
    );
  });

  it("throws on non-string content", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("vault", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, ONE_HUNDRED_TWENTY_THREE, {
        fsApi,
      }),
    ).toThrow("content must be a string");
  });

  it("throws on invalid capBytes", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("vault", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, "x", { capBytes: 0, fsApi }),
    ).toThrow("capBytes must be a positive integer");
  });

  it("throws when fsApi does not provide required methods", () => {
    expect(() =>
      appendToChunked("vault", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, "x", { fsApi: {} }),
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
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", ONE_HUNDRED_TWENTY_THREE);
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

