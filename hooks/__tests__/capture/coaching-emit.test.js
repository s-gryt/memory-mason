"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER } = require("../helpers/test-constants");
const { createTempVaultFixture } = require("../helpers/fs-mock");
const {
  buildCoachingMetaDirPath,
  buildCoachingFrontmatter,
  nextCoachingMetaOrdinal,
  emitCoachingAdvisory,
  emitRepeatedCoachingNag,
} = require("../../lib/capture/coaching-emit");

const { createTempVaultPath, cleanupTempVaultPaths } =
  createTempVaultFixture("coaching-emit-test-");

const DATE_ISO = "2026-06-26";
const SAMPLE_PAYLOAD = {
  kind: "prompt-repeat",
  hash: "abcdef0123456789",
  count: 5,
  sessionId: "session-a",
  iso: "2026-06-26T10:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempVaultPaths();
});

describe("buildCoachingMetaDirPath", () => {
  it("nests under _raw/<date>/_meta", () => {
    const vaultPath = createTempVaultPath();
    const result = buildCoachingMetaDirPath(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO);
    expect(result).toBe(path.join(vaultPath, DEFAULT_SUBFOLDER, "_raw", DATE_ISO, "_meta"));
  });
});

describe("buildCoachingFrontmatter", () => {
  it("emits YAML frontmatter with trailing blank line", () => {
    const result = buildCoachingFrontmatter(SAMPLE_PAYLOAD);
    expect(result).toBe(
      "---\nkind: prompt-repeat\nhash: abcdef0123456789\ncount: 5\nsessionId: session-a\niso: 2026-06-26T10:00:00.000Z\n---\n\n",
    );
  });

  it("appends a JSON-quoted snippet line when present", () => {
    const result = buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, snippet: "fix auth bug" });
    expect(result).toBe(
      '---\nkind: prompt-repeat\nhash: abcdef0123456789\ncount: 5\nsessionId: session-a\niso: 2026-06-26T10:00:00.000Z\nsnippet: "fix auth bug"\n---\n\n',
    );
  });

  it("omits the snippet line when snippet is absent or empty", () => {
    expect(buildCoachingFrontmatter(SAMPLE_PAYLOAD)).not.toContain("snippet:");
    expect(buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, snippet: "" })).not.toContain("snippet:");
  });

  it("throws when fields missing", () => {
    expect(() => buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, kind: "" })).toThrow();
    expect(() => buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, hash: "" })).toThrow();
    expect(() => buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, sessionId: "" })).toThrow();
    expect(() => buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, iso: "" })).toThrow();
  });

  it("throws when count is not positive integer", () => {
    expect(() => buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, count: 0 })).toThrow();
    expect(() => buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, count: -1 })).toThrow();
    expect(() => buildCoachingFrontmatter({ ...SAMPLE_PAYLOAD, count: 1.5 })).toThrow();
  });
});

describe("nextCoachingMetaOrdinal", () => {
  it("returns 1 when directory missing", () => {
    const vaultPath = createTempVaultPath();
    const metaDir = path.join(vaultPath, "missing-meta");
    expect(nextCoachingMetaOrdinal(metaDir)).toBe(1);
  });

  it("returns 1 when directory empty", () => {
    const vaultPath = createTempVaultPath();
    const metaDir = path.join(vaultPath, "empty-meta");
    fs.mkdirSync(metaDir, { recursive: true });
    expect(nextCoachingMetaOrdinal(metaDir)).toBe(1);
  });

  it("returns max+1 from existing NNN.md files", () => {
    const EXPECTED_NEXT_AFTER_007 = 8;
    const vaultPath = createTempVaultPath();
    const metaDir = path.join(vaultPath, "meta");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, "001.md"), "x");
    fs.writeFileSync(path.join(metaDir, "002.md"), "x");
    fs.writeFileSync(path.join(metaDir, "007.md"), "x");
    fs.writeFileSync(path.join(metaDir, "notes.txt"), "x");
    expect(nextCoachingMetaOrdinal(metaDir)).toBe(EXPECTED_NEXT_AFTER_007);
  });

  it("throws when count would exceed 999", () => {
    const vaultPath = createTempVaultPath();
    const metaDir = path.join(vaultPath, "meta");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, "999.md"), "x");
    expect(() => nextCoachingMetaOrdinal(metaDir)).toThrow();
  });
});

describe("emitCoachingAdvisory", () => {
  it("creates the meta directory and writes 001.md on first call", () => {
    const vaultPath = createTempVaultPath();
    const result = emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO, SAMPLE_PAYLOAD);
    expect(result.ordinal).toBe(1);
    const expectedDir = path.join(vaultPath, DEFAULT_SUBFOLDER, "_raw", DATE_ISO, "_meta");
    expect(fs.existsSync(expectedDir)).toBe(true);
    expect(fs.existsSync(path.join(expectedDir, "001.md"))).toBe(true);
    expect(result.filePath).toBe(path.join(expectedDir, "001.md"));
  });

  it("writes frontmatter content matching payload", () => {
    const vaultPath = createTempVaultPath();
    const { filePath } = emitCoachingAdvisory(
      vaultPath,
      DEFAULT_SUBFOLDER,
      DATE_ISO,
      SAMPLE_PAYLOAD,
    );
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("kind: prompt-repeat");
    expect(written).toContain("hash: abcdef0123456789");
    expect(written).toContain("count: 5");
    expect(written).toContain("sessionId: session-a");
  });

  it("retries with the next ordinal when the first advisory path already exists", () => {
    const vaultPath = createTempVaultPath();
    const writtenPaths = [];
    const fsApi = {
      mkdirSync() {},
      readdirSync() {
        return [];
      },
      writeFileSync(filePath) {
        writtenPaths.push(filePath);
        if (writtenPaths.length === 1) {
          const error = new Error("exists");
          error.code = "EEXIST";
          throw error;
        }
      },
    };

    const result = emitCoachingAdvisory(
      vaultPath,
      DEFAULT_SUBFOLDER,
      DATE_ISO,
      SAMPLE_PAYLOAD,
      fsApi,
    );

    expect(result.ordinal).toBe(2);
    expect(writtenPaths.map((filePath) => path.basename(filePath))).toEqual(["001.md", "002.md"]);
  });

  it("increments ordinal across subsequent emits in same day", () => {
    const SECOND_COUNT = 6;
    const vaultPath = createTempVaultPath();
    emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO, SAMPLE_PAYLOAD);
    const second = emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO, {
      ...SAMPLE_PAYLOAD,
      count: SECOND_COUNT,
    });
    expect(second.ordinal).toBe(2);
  });

  it("isolates ordinals per dateIso", () => {
    const vaultPath = createTempVaultPath();
    emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO, SAMPLE_PAYLOAD);
    const otherDate = "2026-06-27";
    const next = emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, otherDate, SAMPLE_PAYLOAD);
    expect(next.ordinal).toBe(1);
  });

  it("throws on invalid inputs", () => {
    const vaultPath = createTempVaultPath();
    expect(() => emitCoachingAdvisory("", DEFAULT_SUBFOLDER, DATE_ISO, SAMPLE_PAYLOAD)).toThrow();
    expect(() => emitCoachingAdvisory(vaultPath, "", DATE_ISO, SAMPLE_PAYLOAD)).toThrow();
    expect(() => emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, "", SAMPLE_PAYLOAD)).toThrow();
    expect(() => emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO, null)).toThrow();
  });

  it("returns state unchanged and does not mark nagged when advisory write fails", () => {
    const vaultPath = createTempVaultPath();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    const inputState = {
      coachingState: {
        promptHashCounts: {
          deadbeef: { count: 3, snippet: "fix auth" },
        },
      },
    };
    const markNagged = vi.fn();
    const result = emitRepeatedCoachingNag({
      state: inputState,
      hash: "deadbeef",
      sessionId: "session-x",
      resolvedConfig: { vaultPath, subfolder: DEFAULT_SUBFOLDER },
      dateIso: DATE_ISO,
      advisory: { kind: "prompt-repeat", iso: "2026-06-26T10:00:00.000Z" },
      shouldEmitNag: () => true,
      markNagged,
    });
    expect(markNagged).not.toHaveBeenCalled();
    expect(result).toBe(inputState);
    stderrSpy.mockRestore();
  });

  it("returns null when the advisory write fails", () => {
    const vaultPath = createTempVaultPath();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fsApi = {
      mkdirSync() {},
      readdirSync() {
        return [];
      },
      writeFileSync() {
        throw new Error("disk full");
      },
    };

    try {
      expect(
        emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO, SAMPLE_PAYLOAD, fsApi),
      ).toBeNull();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("coaching advisory write failed: disk full"),
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("returns null and writes failure prefix to stderr when all 999 ordinals are exhausted via EEXIST", () => {
    const vaultPath = createTempVaultPath();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fsApi = {
      mkdirSync() {},
      readdirSync() {
        return ["998.md"];
      },
      writeFileSync() {
        const error = new Error("exists");
        error.code = "EEXIST";
        throw error;
      },
    };

    try {
      expect(
        emitCoachingAdvisory(vaultPath, DEFAULT_SUBFOLDER, DATE_ISO, SAMPLE_PAYLOAD, fsApi),
      ).toBeNull();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("[memory-mason] coaching advisory write failed"),
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("emitRepeatedCoachingNag", () => {
  it("returns state unchanged when hash is not present in promptHashCounts", () => {
    const inputState = {
      coachingState: {
        promptHashCounts: {},
      },
    };
    const markNagged = vi.fn();
    const result = emitRepeatedCoachingNag({
      state: inputState,
      hash: "unknownhash",
      sessionId: "session-z",
      resolvedConfig: { vaultPath: "/any/path", subfolder: DEFAULT_SUBFOLDER },
      dateIso: DATE_ISO,
      advisory: { kind: "prompt-repeat", iso: "2026-06-26T10:00:00.000Z" },
      shouldEmitNag: () => true,
      markNagged,
    });
    expect(result).toBe(inputState);
    expect(markNagged).not.toHaveBeenCalled();
  });
});
