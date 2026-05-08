"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CAPTURE_HASH_PREFIX_LENGTH,
  DUPLICATE_CAPTURE_WINDOW_MS,
} = require("../../lib/capture/constants");
const { UTF8_ENCODING } = require("../../lib/shared/constants");
const {
  TEST_DEFAULT_SESSION_ID,
  TEST_DEFAULT_VAULT_PATH,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_HOOK_EVENT_PRE_COMPACT_KEBAB: HOOK_EVENT_PRE_COMPACT_KEBAB,
} = require("../helpers/test-constants");
const { createTempVaultFixture } = require("../helpers/fs-mock");
const {
  defaultCaptureState,
  resolveCaptureStatePath,
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getTranscriptTurnCount,
  setTranscriptTurnCount,
  getMmSuppressed,
  setMmSuppressed,
} = require("../../lib/capture/capture-state");

const { createTempVaultPath, cleanupTempVaultPaths } =
  createTempVaultFixture("capture-state-test-");

const TEST_NON_STRING_VALUE = 123;
const TIMESTAMP_BASE_MS = 1714230000000;
const TIMESTAMP_WITHIN_WINDOW_MS = 1714230005000;
const TIMESTAMP_OUTSIDE_WINDOW_MS = 1714230065001;
const TRANSCRIPT_COUNT_TWO = 2;
const TRANSCRIPT_COUNT_THREE = 3;
const TRANSCRIPT_COUNT_FOUR = 4;
const TRANSCRIPT_COUNT_FIVE = 5;
const TRANSCRIPT_COUNT_SIX = 6;
const INVALID_NEGATIVE_COUNT = -1;
const INVALID_FRACTIONAL_COUNT = 1.5;

afterEach(() => {
  cleanupTempVaultPaths();
});

describe("defaultCaptureState", () => {
  it("includes mmSuppressed: false", () => {
    expect(defaultCaptureState()).toEqual({
      lastCapture: null,
      mmSuppressed: false,
    });
  });

  it("returns a new object on each call", () => {
    const first = defaultCaptureState();
    const second = defaultCaptureState();

    expect(first).not.toBe(second);
  });
});

describe("capture state file I/O", () => {
  it("returns default state when capture state file does not exist", () => {
    const vaultPath = createTempVaultPath();
    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual(defaultCaptureState());
  });

  it("saves and loads capture state", () => {
    const vaultPath = createTempVaultPath();
    const state = {
      lastCapture: buildCaptureRecord(
        TEST_DEFAULT_SESSION_ID,
        HOOK_EVENT_PRE_COMPACT_KEBAB,
        "hello",
        TIMESTAMP_BASE_MS,
      ),
      mmSuppressed: false,
    };

    saveCaptureState(vaultPath, DEFAULT_SUBFOLDER, state);

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual(state);
  });

  it("returns default state when capture state file contains invalid JSON", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{invalid-json", UTF8_ENCODING);

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual(defaultCaptureState());
  });

  it("returns default state when capture state JSON is an array", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "[]", UTF8_ENCODING);

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual(defaultCaptureState());
  });

  it("sanitizes invalid lastCapture records when loading state", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: {
          sessionId: TEST_DEFAULT_SESSION_ID,
          source: "",
          contentHash: "abc",
          timestampMs: TIMESTAMP_BASE_MS,
        },
      }),
      UTF8_ENCODING,
    );

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual(defaultCaptureState());
  });

  it("throws when saveCaptureState receives non-object state", () => {
    expect(() => saveCaptureState(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, null)).toThrow(
      "state must be an object",
    );
  });

  it("rethrows non-SyntaxError parsing failures", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const originalParse = JSON.parse;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{"lastCapture":null}', UTF8_ENCODING);
    JSON.parse = () => {
      throw new TypeError("parse failed");
    };

    try {
      expect(() => loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toThrow("parse failed");
    } finally {
      JSON.parse = originalParse;
    }
  });
});

describe("buildCaptureRecord", () => {
  it("builds hashed capture record metadata", () => {
    const record = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      HOOK_EVENT_PRE_COMPACT_KEBAB,
      "hello",
      TIMESTAMP_BASE_MS,
    );

    expect(record.sessionId).toBe(TEST_DEFAULT_SESSION_ID);
    expect(record.source).toBe(HOOK_EVENT_PRE_COMPACT_KEBAB);
    expect(record.contentHash).toHaveLength(CAPTURE_HASH_PREFIX_LENGTH);
    expect(record.timestampMs).toBe(TIMESTAMP_BASE_MS);
  });

  it("throws when timestamp is not a positive integer", () => {
    expect(() =>
      buildCaptureRecord(TEST_DEFAULT_SESSION_ID, HOOK_EVENT_PRE_COMPACT_KEBAB, "hello", 0),
    ).toThrow("timestampMs must be a positive integer");
  });

  it("throws when content is not a string", () => {
    expect(() =>
      buildCaptureRecord(
        TEST_DEFAULT_SESSION_ID,
        HOOK_EVENT_PRE_COMPACT_KEBAB,
        null,
        TIMESTAMP_BASE_MS,
      ),
    ).toThrow("content must be a string");
  });
});

describe("isDuplicateCapture", () => {
  it("returns true for same session and same content hash within 60 seconds", () => {
    const firstCapture = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      HOOK_EVENT_PRE_COMPACT_KEBAB,
      "same content",
      TIMESTAMP_BASE_MS,
    );
    const secondCapture = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      "session-end",
      "same content",
      TIMESTAMP_WITHIN_WINDOW_MS,
    );

    expect(isDuplicateCapture(firstCapture, secondCapture, DUPLICATE_CAPTURE_WINDOW_MS)).toBe(true);
  });

  it("returns false when content differs", () => {
    const firstCapture = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      HOOK_EVENT_PRE_COMPACT_KEBAB,
      "first content",
      TIMESTAMP_BASE_MS,
    );
    const secondCapture = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      "session-end",
      "second content",
      TIMESTAMP_WITHIN_WINDOW_MS,
    );

    expect(isDuplicateCapture(firstCapture, secondCapture, DUPLICATE_CAPTURE_WINDOW_MS)).toBe(
      false,
    );
  });

  it("returns false when time window is exceeded", () => {
    const firstCapture = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      HOOK_EVENT_PRE_COMPACT_KEBAB,
      "same content",
      TIMESTAMP_BASE_MS,
    );
    const secondCapture = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      "session-end",
      "same content",
      TIMESTAMP_OUTSIDE_WINDOW_MS,
    );

    expect(isDuplicateCapture(firstCapture, secondCapture, DUPLICATE_CAPTURE_WINDOW_MS)).toBe(
      false,
    );
  });

  it("returns false when session differs", () => {
    const firstCapture = buildCaptureRecord(
      TEST_DEFAULT_SESSION_ID,
      HOOK_EVENT_PRE_COMPACT_KEBAB,
      "same content",
      TIMESTAMP_BASE_MS,
    );
    const secondCapture = buildCaptureRecord(
      "session-2",
      "session-end",
      "same content",
      TIMESTAMP_WITHIN_WINDOW_MS,
    );

    expect(isDuplicateCapture(firstCapture, secondCapture, DUPLICATE_CAPTURE_WINDOW_MS)).toBe(
      false,
    );
  });

  it("returns false when previous capture is invalid", () => {
    const secondCapture = buildCaptureRecord(
      "session-2",
      "session-end",
      "same content",
      TIMESTAMP_WITHIN_WINDOW_MS,
    );

    expect(isDuplicateCapture({ bad: true }, secondCapture, DUPLICATE_CAPTURE_WINDOW_MS)).toBe(
      false,
    );
  });

  it("throws when next capture is invalid", () => {
    expect(() => isDuplicateCapture(null, null, DUPLICATE_CAPTURE_WINDOW_MS)).toThrow(
      "nextCapture must be a valid capture record",
    );
  });
});

describe("capture-state.js helpers", () => {
  it("getTranscriptTurnCount returns 0 when sessionId not found", () => {
    const state = defaultCaptureState();
    expect(getTranscriptTurnCount(state, "unknown-session")).toBe(0);
  });

  it("getTranscriptTurnCount returns stored count", () => {
    const state = {
      lastCapture: null,
      transcriptTurnCounts: { [TEST_DEFAULT_SESSION_ID]: TRANSCRIPT_COUNT_FIVE },
    };
    expect(getTranscriptTurnCount(state, TEST_DEFAULT_SESSION_ID)).toBe(TRANSCRIPT_COUNT_FIVE);
  });

  it("getTranscriptTurnCount returns 0 for invalid/empty sessionId", () => {
    const state = defaultCaptureState();
    expect(getTranscriptTurnCount(state, "")).toBe(0);
    expect(getTranscriptTurnCount(null, TEST_DEFAULT_SESSION_ID)).toBe(0);
  });

  it("setTranscriptTurnCount stores count for sessionId", () => {
    const state = defaultCaptureState();
    const next = setTranscriptTurnCount(state, TEST_DEFAULT_SESSION_ID, TRANSCRIPT_COUNT_FOUR);
    expect(next.transcriptTurnCounts[TEST_DEFAULT_SESSION_ID]).toBe(TRANSCRIPT_COUNT_FOUR);
    expect(next.lastCapture).toBe(null);
  });

  it("setTranscriptTurnCount preserves other session counts", () => {
    const state = {
      lastCapture: null,
      transcriptTurnCounts: { [TEST_DEFAULT_SESSION_ID]: TRANSCRIPT_COUNT_TWO },
    };
    const next = setTranscriptTurnCount(state, "session-2", TRANSCRIPT_COUNT_SIX);
    expect(next.transcriptTurnCounts[TEST_DEFAULT_SESSION_ID]).toBe(TRANSCRIPT_COUNT_TWO);
    expect(next.transcriptTurnCounts["session-2"]).toBe(TRANSCRIPT_COUNT_SIX);
  });

  it("setTranscriptTurnCount throws on empty sessionId", () => {
    expect(() => setTranscriptTurnCount(defaultCaptureState(), "", 1)).toThrow(
      "sessionId must be a non-empty string",
    );
    expect(() => setTranscriptTurnCount(defaultCaptureState(), TEST_NON_STRING_VALUE, 1)).toThrow(
      "sessionId must be a non-empty string",
    );
  });

  it("setTranscriptTurnCount throws on invalid count", () => {
    expect(() =>
      setTranscriptTurnCount(
        defaultCaptureState(),
        TEST_DEFAULT_SESSION_ID,
        INVALID_NEGATIVE_COUNT,
      ),
    ).toThrow("count must be a non-negative integer");
    expect(() =>
      setTranscriptTurnCount(
        defaultCaptureState(),
        TEST_DEFAULT_SESSION_ID,
        INVALID_FRACTIONAL_COUNT,
      ),
    ).toThrow("count must be a non-negative integer");
  });

  it("setTranscriptTurnCount falls back to default state for non-object state", () => {
    expect(setTranscriptTurnCount(null, TEST_DEFAULT_SESSION_ID, TRANSCRIPT_COUNT_TWO)).toEqual({
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: {
        [TEST_DEFAULT_SESSION_ID]: TRANSCRIPT_COUNT_TWO,
      },
    });
  });

  it("loadCaptureState sanitizes transcriptTurnCounts and keeps only non-negative integers", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });

    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
        transcriptTurnCounts: {
          [TEST_DEFAULT_SESSION_ID]: TRANSCRIPT_COUNT_THREE,
          "session-2": INVALID_NEGATIVE_COUNT,
          "session-3": INVALID_FRACTIONAL_COUNT,
          "session-4": "4",
        },
      }),
      UTF8_ENCODING,
    );

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual({
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: {
        [TEST_DEFAULT_SESSION_ID]: TRANSCRIPT_COUNT_THREE,
      },
    });
  });
});

describe("getMmSuppressed", () => {
  it("returns false when state has no mmSuppressed field", () => {
    expect(getMmSuppressed({ lastCapture: null })).toBe(false);
  });

  it("returns false when mmSuppressed is false", () => {
    expect(getMmSuppressed({ lastCapture: null, mmSuppressed: false })).toBe(false);
  });

  it("returns true when mmSuppressed is true", () => {
    expect(getMmSuppressed({ lastCapture: null, mmSuppressed: true })).toBe(true);
  });

  it("throws when state is not a plain object", () => {
    expect(() => getMmSuppressed(null)).toThrow("state must be an object");
    expect(() => getMmSuppressed([])).toThrow("state must be an object");
  });
});

describe("setMmSuppressed", () => {
  it("returns new state with mmSuppressed set to true", () => {
    expect(setMmSuppressed({ lastCapture: null, mmSuppressed: false }, true)).toEqual({
      lastCapture: null,
      mmSuppressed: true,
    });
  });

  it("returns new state with mmSuppressed set to false", () => {
    expect(setMmSuppressed({ lastCapture: null, mmSuppressed: true }, false)).toEqual({
      lastCapture: null,
      mmSuppressed: false,
    });
  });

  it("does not mutate original state", () => {
    const state = { lastCapture: null, mmSuppressed: false };
    const snapshot = { ...state };
    const next = setMmSuppressed(state, true);

    expect(next).not.toBe(state);
    expect(state).toEqual(snapshot);
  });

  it("preserves other state fields", () => {
    const state = {
      lastCapture: buildCaptureRecord(
        TEST_DEFAULT_SESSION_ID,
        HOOK_EVENT_PRE_COMPACT_KEBAB,
        "hello",
        TIMESTAMP_BASE_MS,
      ),
      mmSuppressed: false,
      transcriptTurnCounts: {
        [TEST_DEFAULT_SESSION_ID]: TRANSCRIPT_COUNT_THREE,
      },
    };
    const next = setMmSuppressed(state, true);

    expect(next.lastCapture).toEqual(state.lastCapture);
    expect(next.transcriptTurnCounts).toEqual(state.transcriptTurnCounts);
    expect(next.mmSuppressed).toBe(true);
  });

  it("throws when state is not a plain object", () => {
    expect(() => setMmSuppressed(null, true)).toThrow("state must be an object");
    expect(() => setMmSuppressed([], true)).toThrow("state must be an object");
  });

  it("throws when suppressed is not a boolean", () => {
    expect(() => setMmSuppressed({ lastCapture: null }, "true")).toThrow(
      "suppressed must be a boolean",
    );
  });
});

describe("mergeWithDefaults - mmSuppressed", () => {
  it("preserves true when state.mmSuppressed is true", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
        mmSuppressed: true,
      }),
      UTF8_ENCODING,
    );

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual({
      lastCapture: null,
      mmSuppressed: true,
    });
  });

  it("preserves false when state.mmSuppressed is false", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
        mmSuppressed: false,
      }),
      UTF8_ENCODING,
    );

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual({
      lastCapture: null,
      mmSuppressed: false,
    });
  });

  it("defaults to false when mmSuppressed is missing", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
      }),
      UTF8_ENCODING,
    );

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual({
      lastCapture: null,
      mmSuppressed: false,
    });
  });

  it("defaults to false when mmSuppressed is not boolean", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
        mmSuppressed: "true",
      }),
      UTF8_ENCODING,
    );

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual({
      lastCapture: null,
      mmSuppressed: false,
    });
  });
});
