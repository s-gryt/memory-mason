"use strict";

const path = require("node:path");
const {
  DEFAULT_DAILY_CHUNK_CAP_BYTES,
  DAILY_CHUNK_HARD_CAP_BYTES,
  MAX_DAILY_CHUNK_COUNT,
  CHUNK_ID_WIDTH,
  SESSION_CHUNK_TIME_WIDTH,
  DAILY_META_SCHEMA_VERSION,
  CONTINUED_CALLOUT_LINE,
  NO_SESSION_SID,
} = require("../../lib/vault/constants");
const { UTF8_ENCODING } = require("../../lib/shared/constants");
const {
  VAULT_RAW_DIR_NAME,
  ROOT_INDEX_FILE_NAME,
  DAILY_META_FILE_NAME,
} = require("../../lib/vault/vault-paths");
const { buildSessionContext, defaultSessionContext } = require("../../lib/vault/vault");
const {
  TEST_DEFAULT_DATE,
  TEST_DEFAULT_DATE_ISO,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
} = require("../helpers/test-constants");

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
const SEVENTH_CHUNK_ID = "007";
const SEVENTH_CHUNK_FILE = `${SEVENTH_CHUNK_ID}.md`;

const CHUNK_COUNT_EXCEEDS_LIMIT_MESSAGE = `chunk count exceeds ${MAX_DAILY_CHUNK_COUNT}`;
const CHUNK_NUM_RANGE_MESSAGE = `chunkNum must be an integer from 1 to ${MAX_DAILY_CHUNK_COUNT}`;

const padChunkId = (chunkNum) => String(chunkNum).padStart(CHUNK_ID_WIDTH, "0");

const {
  loadMeta,
  saveMeta,
  getCurrentChunk,
  getCurrentSessionChunk,
  needsNewChunk,
  resolveRotationDecision,
  nextChunkNum,
  nextSessionChunkNum,
  buildChunkEntry,
  buildSessionChunkEntry,
  appendToChunked,
} = require("../../lib/vault/chunk-writer");

// Helpers for building legacy chunk entries (no sid8)
const makeChunk = (chunkNum, sizeBytes, createdAt = TEST_DEFAULT_DATE_ISO) => {
  const id = padChunkId(chunkNum);
  return {
    id,
    file: `${id}.md`,
    sizeBytes,
    createdAt,
  };
};

// Helpers for building session chunk entries (with sid8)
const makeSessionChunk = (
  chunkNum,
  sid8,
  sessionId,
  timePrefix,
  sizeBytes,
  createdAt = TEST_DEFAULT_DATE_ISO,
) => {
  const id = padChunkId(chunkNum);
  const file = `${timePrefix}-${sid8}-${id}.md`;
  return { id, file, sizeBytes, createdAt, sessionId, sid8 };
};

const buildDailyFolderPath = (vaultPath, subfolder, today) =>
  path.join(vaultPath, subfolder, VAULT_RAW_DIR_NAME, today);

const buildDailyIndexPath = (vaultPath, subfolder, today) =>
  path.join(buildDailyFolderPath(vaultPath, subfolder, today), ROOT_INDEX_FILE_NAME);

const makeFsApi = (initialFiles = {}) => {
  const files = { ...initialFiles };
  const mkdirCalls = [];
  const writeCalls = [];
  const appendCalls = [];
  const renameCalls = [];

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
    renameSync: (fromPath, toPath) => {
      renameCalls.push({ fromPath, toPath });
      if (!hasPath(fromPath)) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      files[toPath] = files[fromPath];
      delete files[fromPath];
    },
    _files: files,
    _mkdirCalls: mkdirCalls,
    _writeCalls: writeCalls,
    _appendCalls: appendCalls,
    _renameCalls: renameCalls,
  };
};

// Build test paths using the actual vault path helpers
const makeChunkPaths = (
  vaultPath = "vault-root",
  subfolder = DEFAULT_SUBFOLDER,
  today = TEST_DEFAULT_DATE,
) => {
  const folderPath = buildDailyFolderPath(vaultPath, subfolder, today);
  const indexPath = buildDailyIndexPath(vaultPath, subfolder, today);
  const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
  return { vaultPath, subfolder, today, folderPath, indexPath, metaPath };
};

// Resolve the session chunk file path from meta
const resolveFirstSessionChunkPath = (fsApi, folderPath) => {
  const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
  return path.join(folderPath, meta.chunks[0].file);
};

const resolveSessionChunkPath = (fsApi, folderPath, chunkIndex) => {
  const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
  return path.join(folderPath, meta.chunks[chunkIndex].file);
};

const TEST_SESSION_ID = "abc123def456";
const TEST_SID8 = "abc123de";
const TEST_SESSION = buildSessionContext(TEST_SESSION_ID, "claude-code", "/repo");
const SESSION_B_ID = "xyz789uvw012";
const SESSION_B_SID8 = "xyz789uv";
const TEST_SESSION_B = buildSessionContext(SESSION_B_ID, "claude-code", "/repo2");

// Helper to run first write with a session
const runFirstWrite = (content = "first", session = TEST_SESSION) => {
  const paths = makeChunkPaths();
  const fsApi = makeFsApi({});
  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, content, {
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
    session,
    fsApi,
  });
  return { ...paths, fsApi, content, session };
};

const runSecondWriteWithoutRotation = (session = TEST_SESSION) => {
  const paths = makeChunkPaths();
  const fsApi = makeFsApi({});
  const firstContent = "first";
  const secondContent = "second";

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, firstContent, {
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
    session,
    fsApi,
  });
  const beforeMeta = JSON.parse(fsApi._files[paths.metaPath]);
  const createdAtBefore = beforeMeta.chunks[0].createdAt;

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, secondContent, {
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
    session,
    fsApi,
  });

  return { ...paths, fsApi, firstContent, secondContent, createdAtBefore, session };
};

const runRotationWrite = (session = TEST_SESSION) => {
  const paths = makeChunkPaths();
  const fsApi = makeFsApi({});
  const firstContent = "x";
  const secondContent = "y";

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, firstContent, {
    capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
    session,
    fsApi,
  });
  const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
  const capBytes = firstMeta.chunks[0].sizeBytes;

  appendToChunked(paths.vaultPath, paths.subfolder, paths.today, secondContent, {
    capBytes,
    session,
    fsApi,
  });

  return { ...paths, fsApi, firstContent, secondContent, capBytes, session };
};

describe("loadMeta", () => {
  it("returns default when meta.json missing (schemaVersion 2, empty chunks)", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const fsApi = makeFsApi({});
    const result = loadMeta(folderPath, fsApi);
    expect(result).toEqual({ schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [] });
  });

  it("parses valid v1 meta.json (no schemaVersion) and upgrades it", () => {
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
    expect(result.schemaVersion).toBe(DAILY_META_SCHEMA_VERSION);
    expect(result.chunks).toHaveLength(TWO);
    expect(result.chunks[0].id).toBe("001");
    expect(result.chunks[1].id).toBe("002");
  });

  it("parses valid v2 meta.json with session chunks", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const meta = {
      schemaVersion: DAILY_META_SCHEMA_VERSION,
      chunks: [makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "143022", TWENTY)],
    };
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify(meta),
    });

    const result = loadMeta(folderPath, fsApi);
    expect(result.schemaVersion).toBe(DAILY_META_SCHEMA_VERSION);
    expect(result.chunks[0].sid8).toBe(TEST_SID8);
    expect(result.chunks[0].sessionId).toBe(TEST_SESSION_ID);
  });

  it("returns default on SyntaxError", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: "{not valid json",
    });

    const result = loadMeta(folderPath, fsApi);
    expect(result).toEqual({ schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [] });
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

  it("throws when chunk ids are non-contiguous within a session group", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        schemaVersion: DAILY_META_SCHEMA_VERSION,
        chunks: [
          makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "100000", 1),
          makeSessionChunk(THREE, TEST_SID8, TEST_SESSION_ID, "100000", 1),
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "chunk ids must be contiguous starting at 001",
    );
  });

  it("throws when schemaVersion is present but invalid", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        schemaVersion: 1,
        chunks: [makeChunk(1, TWENTY)],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "meta schemaVersion must be >= 2 when present",
    );
  });

  it("throws when a session chunk file does not match its sid8", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        schemaVersion: DAILY_META_SCHEMA_VERSION,
        chunks: [
          {
            ...makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "143022", TWENTY),
            file: "143022-mismatch-001.md",
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk file must match chunk sid8 and id");
  });

  it("throws when session chunk sid8 is invalid", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        schemaVersion: DAILY_META_SCHEMA_VERSION,
        chunks: [
          {
            ...makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "143022", TWENTY),
            sid8: "BAD-SID8",
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk sid8 must be lowercase alphanumeric");
  });

  it("throws when session chunk sessionId is not a string", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        schemaVersion: DAILY_META_SCHEMA_VERSION,
        chunks: [
          {
            ...makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "143022", TWENTY),
            sessionId: 42,
          },
        ],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow("chunk sessionId must be a string");
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

  it("throws when chunk file format is invalid for legacy", () => {
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

  it("throws when legacy chunk file does not match chunk id", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        chunks: [
          {
            id: FIRST_CHUNK_ID,
            file: `${SECOND_CHUNK_ID}.md`,
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

  it("accepts mixed v1 legacy and v2 session chunks in same meta", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const meta = {
      chunks: [
        makeChunk(1, TWENTY),
        makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "143022", FORTY),
      ],
    };
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify(meta),
    });

    const result = loadMeta(folderPath, fsApi);
    expect(result.schemaVersion).toBe(DAILY_META_SCHEMA_VERSION);
    expect(result.chunks).toHaveLength(TWO);
    expect(result.chunks[0].sid8).toBeUndefined();
    expect(result.chunks[1].sid8).toBe(TEST_SID8);
  });

  it("accepts schemaVersion 3 and round-trips it as 3 (not downgraded to 2)", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const meta = {
      schemaVersion: THREE,
      chunks: [makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "143022", TWENTY)],
    };
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify(meta),
    });

    const result = loadMeta(folderPath, fsApi);
    expect(result.schemaVersion).toBe(THREE);
    expect(result.chunks).toHaveLength(1);
  });

  it("throws when schemaVersion is 1 (below minimum)", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify({
        schemaVersion: 1,
        chunks: [makeChunk(1, TWENTY)],
      }),
    });

    expect(() => loadMeta(folderPath, fsApi)).toThrow(
      "meta schemaVersion must be >= 2 when present",
    );
  });
});

describe("saveMeta", () => {
  it("writes 2-space indented JSON with schemaVersion 2", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const meta = {
      schemaVersion: DAILY_META_SCHEMA_VERSION,
      chunks: [makeChunk(1, TWELVE)],
    };
    const fsApi = makeFsApi({});

    saveMeta(folderPath, meta, fsApi);

    const written = JSON.parse(fsApi._files[metaPath]);
    expect(written.schemaVersion).toBe(DAILY_META_SCHEMA_VERSION);
    expect(written.chunks).toHaveLength(1);
  });

  it("creates directory if missing", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const fsApi = makeFsApi({});

    saveMeta(
      folderPath,
      { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [makeChunk(1, FIVE)] },
      fsApi,
    );

    expect(fsApi._mkdirCalls).toContain(folderPath);
    expect(fsApi._files[folderPath]).toBe(null);
  });

  it("writes meta.json atomically via temp file and rename", () => {
    const folderPath = path.join("vault", VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const fsApi = makeFsApi({});

    saveMeta(
      folderPath,
      { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [makeChunk(1, FIVE)] },
      fsApi,
    );

    expect(fsApi._renameCalls).toHaveLength(1);
    expect(fsApi._renameCalls[0].toPath).toBe(metaPath);
    expect(fsApi._renameCalls[0].fromPath).not.toBe(metaPath);
    expect(fsApi._writeCalls[0].path).toBe(fsApi._renameCalls[0].fromPath);
    expect(fsApi._files[metaPath]).toBeDefined();
    expect(fsApi._files[fsApi._renameCalls[0].fromPath]).toBeUndefined();
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
    expect(getCurrentChunk({ schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [] })).toBe(null);
  });

  it("returns last element for populated array", () => {
    const meta = {
      schemaVersion: DAILY_META_SCHEMA_VERSION,
      chunks: [makeChunk(1, FIVE), makeChunk(TWO, SIX)],
    };
    expect(getCurrentChunk(meta)).toEqual(makeChunk(TWO, SIX));
  });

  it("accepts meta objects with null prototype", () => {
    const meta = Object.create(null);
    meta.chunks = [];
    expect(getCurrentChunk(meta)).toBe(null);
  });
});

describe("getCurrentSessionChunk", () => {
  it("returns null when no session chunks exist", () => {
    const meta = { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [] };
    expect(getCurrentSessionChunk(meta, TEST_SESSION)).toBe(null);
  });

  it("returns null for legacy chunks when session context is provided", () => {
    const meta = {
      schemaVersion: DAILY_META_SCHEMA_VERSION,
      chunks: [makeChunk(1, TWENTY)],
    };
    expect(getCurrentSessionChunk(meta, TEST_SESSION)).toBe(null);
  });

  it("returns last session chunk matching session", () => {
    const chunk1 = makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "100000", TEN);
    const chunk2 = makeSessionChunk(TWO, TEST_SID8, TEST_SESSION_ID, "100000", TWENTY);
    const meta = { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [chunk1, chunk2] };
    const result = getCurrentSessionChunk(meta, TEST_SESSION);
    expect(result.id).toBe("002");
  });

  it("does not return chunks from a different session", () => {
    const chunk = makeSessionChunk(1, SESSION_B_SID8, SESSION_B_ID, "100000", TEN);
    const meta = { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [chunk] };
    expect(getCurrentSessionChunk(meta, TEST_SESSION)).toBe(null);
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

describe("resolveRotationDecision", () => {
  const SOFT_CAP = 100;
  const HARD_CAP = 1000;

  it("rotates with continued=false when no current chunk", () => {
    const result = resolveRotationDecision(null, TEN, SOFT_CAP, HARD_CAP, false);
    expect(result).toEqual({ rotate: true, continued: false });
  });

  it("does not rotate when exchange is open and under soft cap", () => {
    const result = resolveRotationDecision({ sizeBytes: FIVE }, TEN, SOFT_CAP, HARD_CAP, true);
    expect(result).toEqual({ rotate: false, continued: false });
  });

  it("does not rotate when exchange is open and over soft cap but under hard cap", () => {
    const result = resolveRotationDecision(
      { sizeBytes: NINETY_NINE },
      TEN,
      SOFT_CAP,
      HARD_CAP,
      true,
    );
    expect(result).toEqual({ rotate: false, continued: false });
  });

  it("rotates with continued=true when exchange is open and over hard cap", () => {
    const result = resolveRotationDecision({ sizeBytes: 995 }, TEN, SOFT_CAP, HARD_CAP, true);
    expect(result).toEqual({ rotate: true, continued: true });
  });

  it("rotates with continued=false when exchange is closed and over hard cap", () => {
    const result = resolveRotationDecision({ sizeBytes: 995 }, TEN, SOFT_CAP, HARD_CAP, false);
    expect(result).toEqual({ rotate: true, continued: false });
  });

  it("rotates when exchange is closed and over soft cap", () => {
    const result = resolveRotationDecision({ sizeBytes: 95 }, TEN, SOFT_CAP, HARD_CAP, false);
    expect(result).toEqual({ rotate: true, continued: false });
  });

  it("does not rotate when exchange is closed and exactly at soft cap", () => {
    const result = resolveRotationDecision({ sizeBytes: 90 }, TEN, SOFT_CAP, HARD_CAP, false);
    expect(result).toEqual({ rotate: false, continued: false });
  });

  it("throws when hard cap is not greater than soft cap", () => {
    expect(() =>
      resolveRotationDecision({ sizeBytes: FIVE }, TEN, SOFT_CAP, SOFT_CAP, true),
    ).toThrow("hardCapBytes must be greater than capBytes");
    expect(() => resolveRotationDecision({ sizeBytes: FIVE }, TEN, SOFT_CAP, FORTY, true)).toThrow(
      "hardCapBytes must be greater than capBytes",
    );
  });
});

describe("nextChunkNum", () => {
  it("returns 1 for empty meta", () => {
    expect(nextChunkNum({ chunks: [] })).toBe(1);
  });

  it("returns N+1 for meta with N chunks (all groups)", () => {
    expect(nextChunkNum({ chunks: [makeChunk(1, 1), makeChunk(TWO, 1)] })).toBe(THREE);
  });

  it("throws when total chunk count would exceed MAX_DAILY_CHUNK_COUNT", () => {
    const chunks = Array.from({ length: MAX_DAILY_CHUNK_COUNT }, (_, index) =>
      makeChunk(index + 1, 1),
    );
    expect(() => nextChunkNum({ chunks })).toThrow(CHUNK_COUNT_EXCEEDS_LIMIT_MESSAGE);
  });
});

describe("nextSessionChunkNum", () => {
  it("returns 1 when no prior session chunks", () => {
    const meta = { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [] };
    expect(nextSessionChunkNum(meta, TEST_SESSION)).toBe(1);
  });

  it("returns 2 after one session chunk", () => {
    const meta = {
      schemaVersion: DAILY_META_SCHEMA_VERSION,
      chunks: [makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "100000", TEN)],
    };
    expect(nextSessionChunkNum(meta, TEST_SESSION)).toBe(TWO);
  });

  it("counts only chunks for the same session", () => {
    const meta = {
      schemaVersion: DAILY_META_SCHEMA_VERSION,
      chunks: [
        makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "100000", TEN),
        makeSessionChunk(TWO, TEST_SID8, TEST_SESSION_ID, "100000", TEN),
        makeSessionChunk(1, SESSION_B_SID8, SESSION_B_ID, "110000", TEN),
      ],
    };
    expect(nextSessionChunkNum(meta, TEST_SESSION)).toBe(THREE);
    expect(nextSessionChunkNum(meta, TEST_SESSION_B)).toBe(TWO);
  });

  it("throws when session chunk count would exceed MAX_DAILY_CHUNK_COUNT", () => {
    const chunks = Array.from({ length: MAX_DAILY_CHUNK_COUNT }, (_, index) =>
      makeSessionChunk(index + 1, TEST_SID8, TEST_SESSION_ID, "100000", TEN),
    );

    expect(() =>
      nextSessionChunkNum({ schemaVersion: DAILY_META_SCHEMA_VERSION, chunks }, TEST_SESSION),
    ).toThrow("session chunk count exceeds 999");
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

describe("buildSessionChunkEntry", () => {
  it("includes sid8 and sessionId", () => {
    const entry = buildSessionChunkEntry(1, "143022-abc123de-001.md", TEN, TEST_SESSION);
    expect(entry.sid8).toBe(TEST_SID8);
    expect(entry.sessionId).toBe(TEST_SESSION_ID);
    expect(entry.id).toBe("001");
  });

  it("throws on invalid chunkNum", () => {
    expect(() =>
      buildSessionChunkEntry(ONE_THOUSAND, "143022-abc123de-001.md", TEN, TEST_SESSION),
    ).toThrow(CHUNK_NUM_RANGE_MESSAGE);
  });
});

describe("appendToChunked - first write (session-scoped)", () => {
  it("creates folder via mkdirSync", () => {
    const { fsApi, folderPath } = runFirstWrite("alpha");
    expect(fsApi._mkdirCalls).toContain(folderPath);
  });

  it("creates session-scoped chunk file (HHMMSS-sid8-001.md format)", () => {
    const { fsApi, folderPath } = runFirstWrite("alpha");
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    expect(meta.chunks).toHaveLength(1);
    expect(meta.chunks[0].file).toMatch(/^\d{6}-[a-z0-9]+-001\.md$/);
    expect(meta.chunks[0].sid8).toBe(TEST_SID8);
    expect(meta.chunks[0].sessionId).toBe(TEST_SESSION_ID);
  });

  it("chunk file starts with session header block on first chunk", () => {
    const { fsApi, folderPath } = runFirstWrite("alpha");
    const chunkPath = resolveFirstSessionChunkPath(fsApi, folderPath);
    const content = fsApi._files[chunkPath];
    expect(content).toContain(`## Session ${TEST_SID8}`);
    expect(content).toContain(`**session_id:** ${TEST_SESSION_ID}`);
  });

  it("creates meta.json with schemaVersion 2", () => {
    const { fsApi, folderPath } = runFirstWrite("alpha");
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    expect(meta.schemaVersion).toBe(DAILY_META_SCHEMA_VERSION);
  });

  it("creates index.md", () => {
    const { fsApi, indexPath } = runFirstWrite("alpha");
    expect(fsApi.existsSync(indexPath)).toBe(true);
  });

  it("stores actual file byte size including header", () => {
    const { fsApi, folderPath } = runFirstWrite("alpha");
    const chunkPath = resolveFirstSessionChunkPath(fsApi, folderPath);
    const chunkText = fsApi._files[chunkPath];
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    expect(meta.chunks[0].sizeBytes).toBe(Buffer.byteLength(chunkText, UTF8_ENCODING));
  });
});

describe("appendToChunked - second write same chunk (session-scoped)", () => {
  it("appends to same session chunk file without creating new file", () => {
    const { fsApi, folderPath, firstContent, secondContent } = runSecondWriteWithoutRotation();
    const chunkPath = resolveFirstSessionChunkPath(fsApi, folderPath);
    expect(fsApi._files[chunkPath]).toContain(firstContent);
    expect(fsApi._files[chunkPath]).toContain(secondContent);
  });

  it("updates meta sizeBytes", () => {
    const { fsApi, folderPath } = runSecondWriteWithoutRotation();
    const chunkPath = resolveFirstSessionChunkPath(fsApi, folderPath);
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    expect(meta.chunks[0].sizeBytes).toBe(
      Buffer.byteLength(fsApi._files[chunkPath], UTF8_ENCODING),
    );
  });

  it("does not create a second chunk", () => {
    const { fsApi, folderPath } = runSecondWriteWithoutRotation();
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    expect(meta.chunks).toHaveLength(1);
  });

  it("preserves createdAt for existing chunk", () => {
    const { fsApi, folderPath, createdAtBefore } = runSecondWriteWithoutRotation();
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    expect(meta.chunks[0].createdAt).toBe(createdAtBefore);
  });
});

describe("appendToChunked - rotation triggered (session-scoped)", () => {
  it("creates second session chunk file", () => {
    const { fsApi, folderPath } = runRotationWrite();
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    expect(meta.chunks).toHaveLength(TWO);
    expect(meta.chunks[1].id).toBe(SECOND_CHUNK_ID);
    expect(meta.chunks[1].file).toMatch(/^\d{6}-[a-z0-9]+-002\.md$/);
  });

  it("second chunk does not repeat session header block (only first chunk has it)", () => {
    const { fsApi, folderPath } = runRotationWrite();
    const meta = JSON.parse(fsApi._files[path.join(folderPath, DAILY_META_FILE_NAME)]);
    const secondChunkPath = path.join(folderPath, meta.chunks[1].file);
    const content = fsApi._files[secondChunkPath];
    expect(content).not.toContain(`**session_id:** ${TEST_SESSION_ID}`);
  });

  it("index.md updated with both chunks under session heading", () => {
    const { fsApi, indexPath } = runRotationWrite();
    const content = fsApi._files[indexPath];
    expect(content).toContain(`### Session ${TEST_SID8}`);
  });

  it("throws if next chunk file already exists", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;

    // Manually create a conflicting file with the next expected name
    const timePrefix = meta.chunks[0].file.slice(0, SESSION_CHUNK_TIME_WIDTH);
    const conflictFile = path.join(paths.folderPath, `${timePrefix}-${TEST_SID8}-002.md`);
    fsApi.writeFileSync(conflictFile, "pre-existing", UTF8_ENCODING);

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y", {
        capBytes,
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow("chunk file already exists:");
  });
});

describe("appendToChunked - no rotation at soft cap while exchange open", () => {
  it("does not rotate when exchange is open and content exceeds soft cap", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;

    // Write with exchange open, content that would exceed soft cap
    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(capBytes + 1), {
      capBytes,
      hardCapBytes: DAILY_CHUNK_HARD_CAP_BYTES,
      session: TEST_SESSION,
      exchangeOpen: true,
      fsApi,
    });

    const metaAfter = JSON.parse(fsApi._files[paths.metaPath]);
    expect(metaAfter.chunks).toHaveLength(1);
  });

  it("rotates when exchange is closed and content exceeds soft cap", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(capBytes + 1), {
      capBytes,
      hardCapBytes: DAILY_CHUNK_HARD_CAP_BYTES,
      session: TEST_SESSION,
      exchangeOpen: false,
      fsApi,
    });

    const metaAfter = JSON.parse(fsApi._files[paths.metaPath]);
    expect(metaAfter.chunks).toHaveLength(TWO);
  });
});

describe("appendToChunked - hard cap force rotation with [!continued]", () => {
  it("adds continued callout to end of old chunk on hard cap rotation", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});
    const hardCap = 50;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;
    const overflowBytes = Math.max(1, hardCap - capBytes + 1);

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(overflowBytes), {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      exchangeOpen: true,
      fsApi,
    });

    const firstChunkPath = resolveSessionChunkPath(fsApi, paths.folderPath, 0);
    expect(fsApi._files[firstChunkPath]).toContain(CONTINUED_CALLOUT_LINE);
  });

  it("adds continued callout at start of new chunk on hard cap rotation", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});
    const hardCap = 50;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;
    const overflowBytes = Math.max(1, hardCap - capBytes + 1);

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(overflowBytes), {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      exchangeOpen: true,
      fsApi,
    });

    const metaAfter = JSON.parse(fsApi._files[paths.metaPath]);
    expect(metaAfter.chunks).toHaveLength(TWO);
    const secondChunkPath = resolveSessionChunkPath(fsApi, paths.folderPath, 1);
    expect(fsApi._files[secondChunkPath]).toContain(CONTINUED_CALLOUT_LINE);
  });

  it("throws when hard-cap rotation cannot find the current chunk file", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});
    const hardCap = 50;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      fsApi,
    });

    const firstChunkPath = resolveFirstSessionChunkPath(fsApi, paths.folderPath);
    delete fsApi._files[firstChunkPath];

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(hardCap), {
        capBytes: TWENTY,
        hardCapBytes: hardCap,
        session: TEST_SESSION,
        exchangeOpen: true,
        fsApi,
      }),
    ).toThrow(`current chunk file is missing: ${firstChunkPath}`);
  });

  it("leaves earlier chunks untouched when updating or marking a later chunk", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
      hardCapBytes: DAILY_CHUNK_HARD_CAP_BYTES,
      session: TEST_SESSION,
      fsApi,
    });

    const firstMeta = JSON.parse(fsApi._files[paths.metaPath]);
    const softCapBytes = firstMeta.chunks[0].sizeBytes;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(softCapBytes + 1), {
      capBytes: softCapBytes,
      hardCapBytes: DAILY_CHUNK_HARD_CAP_BYTES,
      session: TEST_SESSION,
      exchangeOpen: false,
      fsApi,
    });

    const firstChunkPath = resolveSessionChunkPath(fsApi, paths.folderPath, 0);
    const firstChunkContentBeforeUpdate = fsApi._files[firstChunkPath];
    const metaAfterRotation = JSON.parse(fsApi._files[paths.metaPath]);
    expect(metaAfterRotation.chunks).toHaveLength(TWO);
    const firstChunkSizeAfterRotation = metaAfterRotation.chunks[0].sizeBytes;

    // Plain append to the current (second) chunk: exercises the map branch
    // that leaves the non-matching first chunk entry unchanged.
    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "z", {
      capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
      hardCapBytes: DAILY_CHUNK_HARD_CAP_BYTES,
      session: TEST_SESSION,
      fsApi,
    });

    const metaAfterAppend = JSON.parse(fsApi._files[paths.metaPath]);
    expect(metaAfterAppend.chunks).toHaveLength(TWO);
    expect(metaAfterAppend.chunks[0].sizeBytes).toBe(firstChunkSizeAfterRotation);
    expect(fsApi._files[firstChunkPath]).toBe(firstChunkContentBeforeUpdate);

    const hardCap = metaAfterAppend.chunks[1].sizeBytes + 1;

    // Hard-cap forced rotation off the second chunk: exercises the
    // markChunkContinued map branch that leaves the first chunk entry unchanged.
    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "w".repeat(hardCap), {
      capBytes: metaAfterAppend.chunks[1].sizeBytes,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      exchangeOpen: true,
      fsApi,
    });

    const metaAfterHardCap = JSON.parse(fsApi._files[paths.metaPath]);
    expect(metaAfterHardCap.chunks).toHaveLength(THREE);
    expect(metaAfterHardCap.chunks[0].sizeBytes).toBe(firstChunkSizeAfterRotation);
    expect(fsApi._files[firstChunkPath]).toBe(firstChunkContentBeforeUpdate);
    const secondChunkPathHardCap = resolveSessionChunkPath(fsApi, paths.folderPath, 1);
    expect(fsApi._files[secondChunkPathHardCap]).toContain(CONTINUED_CALLOUT_LINE);
  });
});

describe("appendToChunked - continued marker rollback on rotate failure", () => {
  it("rolls back the continued marker when rotateToNewSessionChunk throws", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});
    const hardCap = 50;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;
    const overflowBytes = Math.max(1, hardCap - capBytes + 1);
    const firstChunkPath = resolveSessionChunkPath(fsApi, paths.folderPath, 0);
    const contentBeforeMarker = fsApi._files[firstChunkPath];

    const originalWriteFileSync = fsApi.writeFileSync.bind(fsApi);
    let writeCallCount = 0;
    fsApi.writeFileSync = (p, data, encoding) => {
      writeCallCount += 1;
      if (writeCallCount === 1) {
        throw new Error("simulated rotate write failure");
      }
      originalWriteFileSync(p, data, encoding);
    };

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(overflowBytes), {
        capBytes: TWENTY,
        hardCapBytes: hardCap,
        session: TEST_SESSION,
        exchangeOpen: true,
        fsApi,
      }),
    ).toThrow("simulated rotate write failure");

    expect(fsApi._files[firstChunkPath]).toBe(contentBeforeMarker);
    expect(fsApi._files[firstChunkPath]).not.toContain(CONTINUED_CALLOUT_LINE);
  });

  it("keeps the original rotate error when rollback throws", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});
    const hardCap = 50;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;
    const overflowBytes = Math.max(1, hardCap - capBytes + 1);
    const firstChunkPath = resolveSessionChunkPath(fsApi, paths.folderPath, 0);

    const originalWriteFileSync = fsApi.writeFileSync.bind(fsApi);
    let writeCallCount = 0;
    fsApi.writeFileSync = (p, data, encoding) => {
      writeCallCount += 1;
      if (writeCallCount === 1) {
        throw new Error("simulated rotate write failure");
      }
      if (writeCallCount === 2) {
        throw new Error("simulated rollback write failure");
      }
      originalWriteFileSync(p, data, encoding);
    };

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(overflowBytes), {
        capBytes: TWENTY,
        hardCapBytes: hardCap,
        session: TEST_SESSION,
        exchangeOpen: true,
        fsApi,
      }),
    ).toThrow("simulated rotate write failure");
    const metaAfterFailure = JSON.parse(fsApi._files[paths.metaPath]);
    expect(writeCallCount).toBe(THREE);
    expect(fsApi._files[firstChunkPath]).toContain(CONTINUED_CALLOUT_LINE);
    expect(metaAfterFailure.chunks[0].sizeBytes).toBe(
      Buffer.byteLength(fsApi._files[firstChunkPath], UTF8_ENCODING),
    );
  });

  it("swallows best-effort meta save failure and still throws the rotate error", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});
    const hardCap = 50;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: TWENTY,
      hardCapBytes: hardCap,
      session: TEST_SESSION,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    const capBytes = meta.chunks[0].sizeBytes;
    const overflowBytes = Math.max(1, hardCap - capBytes + 1);

    let writeCallCount = 0;
    fsApi.writeFileSync = () => {
      writeCallCount += 1;
      if (writeCallCount === 1) {
        throw new Error("simulated rotate write failure");
      }
      if (writeCallCount === 2) {
        throw new Error("simulated rollback write failure");
      }
      throw new Error("simulated meta save failure");
    };

    const stderrMessages = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrMessages.push(String(chunk));
      return true;
    });

    try {
      expect(() =>
        appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y".repeat(overflowBytes), {
          capBytes: TWENTY,
          hardCapBytes: hardCap,
          session: TEST_SESSION,
          exchangeOpen: true,
          fsApi,
        }),
      ).toThrow("simulated rotate write failure");
    } finally {
      stderrSpy.mockRestore();
    }

    expect(writeCallCount).toBe(THREE);
    expect(stderrMessages.join("")).toContain("failed to persist chunk meta after rotate failure");
  });
});

describe("appendToChunked - two concurrent sessions produce separate files", () => {
  it("two sessions write to different chunk files", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "session-a-content", {
      session: TEST_SESSION,
      fsApi,
    });

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "session-b-content", {
      session: TEST_SESSION_B,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    expect(meta.chunks).toHaveLength(TWO);
    expect(meta.chunks[0].sid8).toBe(TEST_SID8);
    expect(meta.chunks[1].sid8).toBe(SESSION_B_SID8);
    const fileA = path.join(paths.folderPath, meta.chunks[0].file);
    const fileB = path.join(paths.folderPath, meta.chunks[1].file);
    expect(fsApi._files[fileA]).toContain("session-a-content");
    expect(fsApi._files[fileB]).toContain("session-b-content");
    expect(fsApi._files[fileA]).not.toContain("session-b-content");
    expect(fsApi._files[fileB]).not.toContain("session-a-content");
  });

  it("per-session counter is independent: each starts at 001", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "a1", {
      session: TEST_SESSION,
      fsApi,
    });
    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "b1", {
      session: TEST_SESSION_B,
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    expect(meta.chunks[0].id).toBe("001");
    expect(meta.chunks[1].id).toBe("001");
  });
});

describe("appendToChunked - nosession fallback", () => {
  it("uses 'nosession' as sid8 when session is defaultSessionContext", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "no-session-content", {
      session: defaultSessionContext(),
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    expect(meta.chunks[0].sid8).toBe(NO_SESSION_SID);
    expect(meta.chunks[0].file).toContain(NO_SESSION_SID);
  });

  it("uses default session context when session option is omitted", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "fallback", {
      fsApi,
    });

    const meta = JSON.parse(fsApi._files[paths.metaPath]);
    expect(meta.chunks[0].sid8).toBe(NO_SESSION_SID);
  });
});

describe("appendToChunked - time prefix stability", () => {
  it("stable time prefix: second chunk reuses same HHMMSS from first chunk", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
      capBytes: DEFAULT_DAILY_CHUNK_CAP_BYTES,
      session: TEST_SESSION,
      fsApi,
    });

    const meta1 = JSON.parse(fsApi._files[paths.metaPath]);
    const firstFile = meta1.chunks[0].file;
    const timePrefix = firstFile.slice(0, SESSION_CHUNK_TIME_WIDTH);
    const capBytes = meta1.chunks[0].sizeBytes;

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "y", {
      capBytes,
      session: TEST_SESSION,
      fsApi,
    });

    const meta2 = JSON.parse(fsApi._files[paths.metaPath]);
    const secondFile = meta2.chunks[1].file;
    expect(secondFile.startsWith(timePrefix)).toBe(true);
  });
});

describe("appendToChunked - index grouping", () => {
  it("index groups session chunks under ### Session heading", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({});

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "content", {
      session: TEST_SESSION,
      fsApi,
    });

    const indexContent = fsApi._files[paths.indexPath];
    expect(indexContent).toContain(`### Session ${TEST_SID8}`);
  });

  it("index groups legacy chunks under Legacy heading", () => {
    const paths = makeChunkPaths();
    const folderPath = buildDailyFolderPath(paths.vaultPath, paths.subfolder, paths.today);
    const metaPath = path.join(folderPath, DAILY_META_FILE_NAME);
    const existingMeta = {
      schemaVersion: DAILY_META_SCHEMA_VERSION,
      chunks: [makeChunk(1, TEN)],
    };
    const legacyChunkPath = path.join(folderPath, "001.md");
    const fsApi = makeFsApi({
      [folderPath]: null,
      [metaPath]: JSON.stringify(existingMeta),
      [legacyChunkPath]: "legacy content",
    });

    appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "new-session-content", {
      session: TEST_SESSION,
      fsApi,
    });

    const indexContent = fsApi._files[paths.indexPath];
    expect(indexContent).toContain("### Legacy");
    expect(indexContent).toContain(`### Session ${TEST_SID8}`);
  });
});

describe("appendToChunked - corruption guards", () => {
  it("throws when folder path exists as a file", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: "not a directory",
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow(`daily folder path is not a directory: ${paths.folderPath}`);
  });

  it("throws when meta.json is missing in a non-empty chunk folder", () => {
    const paths = makeChunkPaths();
    const legacyChunkPath = path.join(paths.folderPath, "001.md");
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [legacyChunkPath]: "existing chunk",
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow(`meta.json missing for existing chunk folder: ${paths.folderPath}`);
  });

  it("throws when meta.json is missing and index.md exists in the folder", () => {
    const paths = makeChunkPaths();
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.indexPath]: "existing index",
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow(`meta.json missing for existing chunk folder: ${paths.folderPath}`);
  });

  it("throws when current chunk file is missing on append", () => {
    const paths = makeChunkPaths();
    const chunk = makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "100000", TEN);
    const existingMeta = { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [chunk] };
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.metaPath]: JSON.stringify(existingMeta),
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
        capBytes: MAX_DAILY_CHUNK_COUNT,
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow("current chunk file is missing:");
  });

  it("throws when current chunk path is not a file", () => {
    const paths = makeChunkPaths();
    const chunk = makeSessionChunk(1, TEST_SID8, TEST_SESSION_ID, "100000", TEN);
    const existingMeta = { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [chunk] };
    const chunkPath = path.join(paths.folderPath, chunk.file);
    const fsApi = makeFsApi({
      [paths.folderPath]: null,
      [paths.metaPath]: JSON.stringify(existingMeta),
      [chunkPath]: null, // directory, not file
    });

    expect(() =>
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", {
        capBytes: MAX_DAILY_CHUNK_COUNT,
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow("current chunk path is not a file:");
  });
});

describe("appendToChunked - validation", () => {
  it("throws on empty vaultPath", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, "x", {
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow("vaultPath must be a non-empty string");
  });

  it("throws on empty subfolder", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("vault", "", TEST_DEFAULT_DATE, "x", { session: TEST_SESSION, fsApi }),
    ).toThrow("subfolder must be a non-empty string");
  });

  it("throws on empty today", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("vault", DEFAULT_SUBFOLDER, "", "x", { session: TEST_SESSION, fsApi }),
    ).toThrow("today must be a non-empty string");
  });

  it("throws on non-string content", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("vault", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, ONE_HUNDRED_TWENTY_THREE, {
        session: TEST_SESSION,
        fsApi,
      }),
    ).toThrow("content must be a string");
  });

  it("throws on invalid capBytes", () => {
    const fsApi = makeFsApi({});
    expect(() =>
      appendToChunked("vault", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, "x", {
        capBytes: 0,
        session: TEST_SESSION,
        fsApi,
      }),
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
        .spyOn(nodeFs, "renameSync")
        .mockImplementation((fromPath, toPath) => delegatedFsApi.renameSync(fromPath, toPath)),
      vi
        .spyOn(nodeFs, "appendFileSync")
        .mockImplementation((p, data, encoding) =>
          delegatedFsApi.appendFileSync(p, data, encoding),
        ),
    ];

    try {
      appendToChunked(paths.vaultPath, paths.subfolder, paths.today, "x", ONE_HUNDRED_TWENTY_THREE);
      const meta = JSON.parse(delegatedFsApi._files[paths.metaPath]);
      expect(meta.chunks).toHaveLength(1);
      expect(meta.chunks[0].file).toMatch(/^\d{6}-[a-z0-9]+-001\.md$/);
    } finally {
      spies.forEach((spy) => {
        spy.mockRestore();
      });
    }
  });
});
