"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CAPTURE_HASH_PREFIX_LENGTH,
  DUPLICATE_CAPTURE_WINDOW_MS,
  COACHING_NAG_THRESHOLD,
  COACHING_NAG_SESSION_MEMORY,
  COACHING_HASH_COUNTS_MAX,
  COACHING_LRU_LOW_USE_FLOOR,
  COACHING_DECAY_MS,
  COACHING_DECAY_NAGGED_WINDOW_MS,
  COACHING_KIND_PROMPT_REPEAT,
  COACHING_KIND_ERROR_REPEAT,
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
  normalizeCoachingPromptText,
  hashCoachingPrompt,
  normalizeCoachingErrorText,
  hashCoachingError,
  buildCoachingSnippet,
  compareCoachingEntriesForEviction,
  recordCoachingHit,
  shouldEmitCoachingNag,
  markCoachingNagged,
  isExchangeOpen,
  openExchange,
  closeExchange,
} = require("../../lib/capture/capture-state");
const { EXCHANGE_STALE_OPEN_MS } = require("../../lib/capture/constants");

const { createTempVaultPath, cleanupTempVaultPaths } =
  createTempVaultFixture("capture-state-test-");

const TEST_NON_STRING_VALUE = 123;
const TIMESTAMP_BASE_MS = 1714230000000;
const TIMESTAMP_WITHIN_WINDOW_MS = 1714230005000;
const TIMESTAMP_OUTSIDE_WINDOW_MS = 1714230065001;
const ONE_SECOND_MS = 1000;
const TRANSCRIPT_COUNT_TWO = 2;
const TRANSCRIPT_COUNT_THREE = 3;
const TRANSCRIPT_COUNT_FOUR = 4;
const TRANSCRIPT_COUNT_FIVE = 5;
const TRANSCRIPT_COUNT_SIX = 6;
const INVALID_NEGATIVE_COUNT = -1;
const INVALID_FRACTIONAL_COUNT = 1.5;
const LONG_COACHING_PROMPT_REPEAT_COUNT = 40;
const COACHING_SNIPPET_LENGTH_CAP = 80;

afterEach(() => {
  cleanupTempVaultPaths();
});

describe("defaultCaptureState", () => {
  it("includes mmSuppressed: false", () => {
    expect(defaultCaptureState()).toEqual({
      lastCapture: null,
      mmSuppressed: false,
      coachingState: { promptHashCounts: {} },
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
      coachingState: { promptHashCounts: {} },
    };

    saveCaptureState(vaultPath, DEFAULT_SUBFOLDER, state);

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual(state);
  });

  it("sweeps stale exchange entries on save while preserving active exchanges", () => {
    const vaultPath = createTempVaultPath();
    const staleIso = new Date(Date.now() - EXCHANGE_STALE_OPEN_MS - ONE_SECOND_MS).toISOString();
    const activeIso = new Date(Date.now() - ONE_SECOND_MS).toISOString();
    const state = {
      ...defaultCaptureState(),
      exchanges: {
        stale: { open: true, openedAtIso: staleIso },
        active: { open: true, openedAtIso: activeIso },
      },
    };

    saveCaptureState(vaultPath, DEFAULT_SUBFOLDER, state);

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual({
      ...defaultCaptureState(),
      exchanges: {
        active: { open: true, openedAtIso: activeIso },
      },
    });
  });

  it("drops invalid exchange entries on save", () => {
    const vaultPath = createTempVaultPath();
    const activeIso = new Date(Date.now() - ONE_SECOND_MS).toISOString();
    const state = {
      ...defaultCaptureState(),
      exchanges: {
        invalidShape: null,
        closed: { open: false, openedAtIso: activeIso },
        invalidDate: { open: true, openedAtIso: 123 },
        active: { open: true, openedAtIso: activeIso },
      },
    };

    saveCaptureState(vaultPath, DEFAULT_SUBFOLDER, state);

    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER)).toEqual({
      ...defaultCaptureState(),
      exchanges: {
        active: { open: true, openedAtIso: activeIso },
      },
    });
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

  it("strips non-string entries from nagSessions when loading coaching state", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const validIso = new Date().toISOString();

    const INVALID_NAG_SESSION_ID = 42;

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
        coachingState: {
          promptHashCounts: {
            abc123: {
              count: 1,
              firstSeenIso: validIso,
              lastSeenIso: validIso,
              nagSessions: ["valid-session", INVALID_NAG_SESSION_ID, "another-valid", null],
            },
          },
        },
      }),
      UTF8_ENCODING,
    );

    const loaded = loadCaptureState(vaultPath, DEFAULT_SUBFOLDER);
    const entry = loaded.coachingState.promptHashCounts.abc123;

    expect(entry.nagSessions).toEqual(["valid-session", "another-valid"]);
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
      coachingState: { promptHashCounts: {} },
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
      coachingState: { promptHashCounts: {} },
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

describe("normalizeCoachingPromptText", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeCoachingPromptText("  Fix    Auth   Bug  ")).toBe("fix auth bug");
  });

  it("throws on non-string", () => {
    expect(() => normalizeCoachingPromptText(TEST_NON_STRING_VALUE)).toThrow();
  });

  it("throws when blank after normalization", () => {
    expect(() => normalizeCoachingPromptText("   ")).toThrow();
  });
});

describe("hashCoachingPrompt", () => {
  it("returns identical hash for whitespace/case variants", () => {
    expect(hashCoachingPrompt("  Fix    Auth   Bug  ")).toBe(hashCoachingPrompt("fix auth bug"));
  });

  it("returns 16-hex prefix", () => {
    expect(hashCoachingPrompt("hello world")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("normalizeCoachingErrorText", () => {
  it("uses the most relevant error line and normalizes digits", () => {
    expect(normalizeCoachingErrorText("info line\nSomething failed 42\nignored")).toBe(
      "something failed #",
    );
  });

  it("throws when text is blank after normalization", () => {
    expect(() => normalizeCoachingErrorText("   \n  ")).toThrow();
  });

  it("throws when text is not a string", () => {
    expect(() => normalizeCoachingErrorText(TEST_NON_STRING_VALUE)).toThrow(
      "text must be a string",
    );
  });
});

describe("hashCoachingError", () => {
  it("returns identical hash for equivalent error variants", () => {
    expect(hashCoachingError("FAIL 123")).toBe(hashCoachingError("fail 999"));
  });

  it("returns 16-hex prefix", () => {
    expect(hashCoachingError("something failed")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("buildCoachingSnippet", () => {
  it("truncates a long normalized prompt to the snippet length cap", () => {
    const longText = "fix ".repeat(LONG_COACHING_PROMPT_REPEAT_COUNT);
    const snippet = buildCoachingSnippet(COACHING_KIND_PROMPT_REPEAT, longText);
    expect(snippet.length).toBeLessThanOrEqual(COACHING_SNIPPET_LENGTH_CAP);
    expect(snippet).toBe(
      normalizeCoachingPromptText(longText).slice(0, COACHING_SNIPPET_LENGTH_CAP),
    );
  });

  it("builds from the error normalization for error-repeat kind", () => {
    const snippet = buildCoachingSnippet(COACHING_KIND_ERROR_REPEAT, "Error: build failed at 42");
    expect(snippet).toBe(
      normalizeCoachingErrorText("Error: build failed at 42").slice(0, COACHING_SNIPPET_LENGTH_CAP),
    );
  });

  it("throws when the underlying text normalizes to blank", () => {
    expect(() => buildCoachingSnippet(COACHING_KIND_PROMPT_REPEAT, "   ")).toThrow();
  });
});

describe("compareCoachingEntriesForEviction", () => {
  it("orders older entries first when counts have the same eviction bucket", () => {
    expect(
      compareCoachingEntriesForEviction(
        ["a", { count: 1, lastSeenIso: "2026-06-26T10:00:00.000Z" }],
        ["b", { count: 1, lastSeenIso: "2026-06-26T11:00:00.000Z" }],
      ),
    ).toBe(-1);
    expect(
      compareCoachingEntriesForEviction(
        ["a", { count: 1, lastSeenIso: "2026-06-26T11:00:00.000Z" }],
        ["b", { count: 1, lastSeenIso: "2026-06-26T10:00:00.000Z" }],
      ),
    ).toBe(1);
  });
});

describe("recordCoachingHit", () => {
  const ISO_A = "2026-06-26T10:00:00.000Z";
  const ISO_B = "2026-06-26T11:00:00.000Z";
  const SESSION_A = "session-a";
  const HASH_A = "abcdef0123456789";

  it("creates entry on first hit", () => {
    const next = recordCoachingHit(defaultCaptureState(), HASH_A, SESSION_A, ISO_A);
    expect(next.coachingState.promptHashCounts[HASH_A]).toEqual({
      count: 1,
      firstSeenIso: ISO_A,
      lastSeenIso: ISO_A,
      nagSessions: [],
      kind: COACHING_KIND_PROMPT_REPEAT,
    });
  });

  it("increments count and updates lastSeenIso on repeat", () => {
    const first = recordCoachingHit(defaultCaptureState(), HASH_A, SESSION_A, ISO_A);
    const second = recordCoachingHit(first, HASH_A, SESSION_A, ISO_B);
    expect(second.coachingState.promptHashCounts[HASH_A].count).toBe(2);
    expect(second.coachingState.promptHashCounts[HASH_A].lastSeenIso).toBe(ISO_B);
    expect(second.coachingState.promptHashCounts[HASH_A].firstSeenIso).toBe(ISO_A);
  });

  it("does not mutate input state", () => {
    const input = defaultCaptureState();
    recordCoachingHit(input, HASH_A, SESSION_A, ISO_A);
    expect(input.coachingState.promptHashCounts).toEqual({});
  });

  it("stores the snippet when provided", () => {
    const next = recordCoachingHit(
      defaultCaptureState(),
      HASH_A,
      SESSION_A,
      ISO_A,
      COACHING_KIND_PROMPT_REPEAT,
      "fix auth bug",
    );
    expect(next.coachingState.promptHashCounts[HASH_A].snippet).toBe("fix auth bug");
  });

  it("replaces the stored snippet with the newest one on repeat", () => {
    const first = recordCoachingHit(
      defaultCaptureState(),
      HASH_A,
      SESSION_A,
      ISO_A,
      COACHING_KIND_PROMPT_REPEAT,
      "fix auth bug",
    );
    const second = recordCoachingHit(
      first,
      HASH_A,
      SESSION_A,
      ISO_B,
      COACHING_KIND_PROMPT_REPEAT,
      "fix auth bug again",
    );
    expect(second.coachingState.promptHashCounts[HASH_A].snippet).toBe("fix auth bug again");
  });

  it("omits snippet entirely when not provided", () => {
    const next = recordCoachingHit(defaultCaptureState(), HASH_A, SESSION_A, ISO_A);
    expect(next.coachingState.promptHashCounts[HASH_A]).not.toHaveProperty("snippet");
  });

  it("evicts low-count entries when above cap", () => {
    const HASH_PAD_WIDTH = 15;
    const overflow = COACHING_HASH_COUNTS_MAX + 1;
    const seeded = Array.from({ length: overflow }, (_, i) => i).reduce((acc, i) => {
      const hash = `h${String(i).padStart(HASH_PAD_WIDTH, "0")}`;
      return recordCoachingHit(acc, hash, SESSION_A, ISO_A);
    }, defaultCaptureState());
    expect(Object.keys(seeded.coachingState.promptHashCounts).length).toBeLessThanOrEqual(
      COACHING_HASH_COUNTS_MAX,
    );
  });

  it("throws on invalid inputs", () => {
    expect(() => recordCoachingHit(defaultCaptureState(), "", SESSION_A, ISO_A)).toThrow();
    expect(() => recordCoachingHit(defaultCaptureState(), HASH_A, "", ISO_A)).toThrow();
    expect(() => recordCoachingHit(defaultCaptureState(), HASH_A, SESSION_A, "")).toThrow();
  });

  it("evicts low-use entries first when mixed use frequencies cause overflow", () => {
    const HASH_PAD_WIDTH = 15;
    const ISO_A = "2026-06-27T00:00:00.000Z";
    const HASH_HIGH = "hhigh00000000000";
    let state = defaultCaptureState();
    for (let i = 0; i < COACHING_HASH_COUNTS_MAX - 2; i++) {
      state = recordCoachingHit(
        state,
        `h${String(i).padStart(HASH_PAD_WIDTH, "0")}`,
        SESSION_A,
        ISO_A,
      );
    }
    for (let i = 0; i < COACHING_LRU_LOW_USE_FLOOR; i++) {
      state = recordCoachingHit(state, HASH_HIGH, SESSION_A, ISO_A);
    }
    state = recordCoachingHit(state, "hnew0000000000000", SESSION_A, ISO_A);
    state = recordCoachingHit(state, "hnew0000000000001", SESSION_A, ISO_A);
    expect(Object.keys(state.coachingState.promptHashCounts).length).toBeLessThanOrEqual(
      COACHING_HASH_COUNTS_MAX,
    );
    expect(state.coachingState.promptHashCounts[HASH_HIGH]).toBeDefined();
  });

  it("evicts by oldest lastSeenIso when entries have different timestamps", () => {
    const HASH_PAD_WIDTH = 15;
    const ISO_OLD = "2026-01-01T00:00:00.000Z";
    const ISO_NEW = "2026-06-27T00:00:00.000Z";
    let state = defaultCaptureState();
    for (let i = 0; i < COACHING_HASH_COUNTS_MAX + 1; i++) {
      const iso = i % 2 === 0 ? ISO_OLD : ISO_NEW;
      state = recordCoachingHit(
        state,
        `h${String(i).padStart(HASH_PAD_WIDTH, "0")}`,
        SESSION_A,
        iso,
      );
    }
    expect(Object.keys(state.coachingState.promptHashCounts).length).toBeLessThanOrEqual(
      COACHING_HASH_COUNTS_MAX,
    );
  });

  it("defaults to prompt-repeat and decays stale low-count entries", () => {
    const NOW_ISO = "2026-07-01T00:00:00.000Z";
    const STALE_ISO = new Date(
      Date.parse(NOW_ISO) - COACHING_DECAY_MS - ONE_SECOND_MS,
    ).toISOString();
    const HASH_STALE = "fedcba9876543210";
    const HASH_RETAINED = "0123456789abcdef";
    const initial = {
      coachingState: {
        promptHashCounts: {
          [HASH_STALE]: {
            count: 1,
            firstSeenIso: STALE_ISO,
            lastSeenIso: STALE_ISO,
            nagSessions: [],
            kind: COACHING_KIND_PROMPT_REPEAT,
          },
          [HASH_RETAINED]: {
            count: COACHING_NAG_THRESHOLD,
            firstSeenIso: STALE_ISO,
            lastSeenIso: STALE_ISO,
            nagSessions: [],
            kind: COACHING_KIND_PROMPT_REPEAT,
          },
        },
      },
    };

    const next = recordCoachingHit(initial, HASH_A, SESSION_A, NOW_ISO, COACHING_KIND_ERROR_REPEAT);

    expect(next.coachingState.promptHashCounts[HASH_A]).toEqual({
      count: 1,
      firstSeenIso: NOW_ISO,
      lastSeenIso: NOW_ISO,
      nagSessions: [],
      kind: COACHING_KIND_ERROR_REPEAT,
    });
    expect(next.coachingState.promptHashCounts[HASH_STALE]).toBeUndefined();
    expect(next.coachingState.promptHashCounts[HASH_RETAINED]).toBeDefined();
  });

  it("decays nag-threshold coaching entries after 90 days", () => {
    const NOW_ISO = "2026-07-01T00:00:00.000Z";
    const STALE_NAGGED_ISO = new Date(
      Date.parse(NOW_ISO) - COACHING_DECAY_NAGGED_WINDOW_MS - ONE_SECOND_MS,
    ).toISOString();
    const HASH_STALE_NAGGED = "1111111111111111";
    const next = recordCoachingHit(
      {
        coachingState: {
          promptHashCounts: {
            [HASH_STALE_NAGGED]: {
              count: COACHING_NAG_THRESHOLD,
              firstSeenIso: STALE_NAGGED_ISO,
              lastSeenIso: STALE_NAGGED_ISO,
              nagSessions: [],
              kind: COACHING_KIND_PROMPT_REPEAT,
            },
          },
        },
      },
      HASH_A,
      SESSION_A,
      NOW_ISO,
    );

    expect(next.coachingState.promptHashCounts[HASH_STALE_NAGGED]).toBeUndefined();
  });

  it("retains nag-threshold coaching entries inside the 90-day decay window", () => {
    const NOW_ISO = "2026-07-01T00:00:00.000Z";
    const RETAINED_NAGGED_ISO = new Date(
      Date.parse(NOW_ISO) - COACHING_DECAY_NAGGED_WINDOW_MS + ONE_SECOND_MS,
    ).toISOString();
    const HASH_RETAINED_NAGGED = "2222222222222222";
    const next = recordCoachingHit(
      {
        coachingState: {
          promptHashCounts: {
            [HASH_RETAINED_NAGGED]: {
              count: COACHING_NAG_THRESHOLD,
              firstSeenIso: RETAINED_NAGGED_ISO,
              lastSeenIso: RETAINED_NAGGED_ISO,
              nagSessions: [],
              kind: COACHING_KIND_PROMPT_REPEAT,
            },
          },
        },
      },
      HASH_A,
      SESSION_A,
      NOW_ISO,
    );

    expect(next.coachingState.promptHashCounts[HASH_RETAINED_NAGGED]).toBeDefined();
  });

  it("falls back to the current call's kind when an existing entry has no kind", () => {
    const next = recordCoachingHit(
      {
        coachingState: {
          promptHashCounts: {
            [HASH_A]: {
              count: 1,
              firstSeenIso: ISO_A,
              lastSeenIso: ISO_A,
              nagSessions: [],
            },
          },
        },
      },
      HASH_A,
      SESSION_A,
      ISO_B,
      COACHING_KIND_ERROR_REPEAT,
    );

    expect(next.coachingState.promptHashCounts[HASH_A].kind).toBe(COACHING_KIND_ERROR_REPEAT);
  });

  it("drops low-count entries with invalid lastSeenIso during decay", () => {
    const next = recordCoachingHit(
      {
        coachingState: {
          promptHashCounts: {
            deadbeefdeadbeef: {
              count: 1,
              firstSeenIso: "2026-06-26T10:00:00.000Z",
              lastSeenIso: "not-an-iso",
              nagSessions: [],
              kind: COACHING_KIND_PROMPT_REPEAT,
            },
          },
        },
      },
      HASH_A,
      SESSION_A,
      "2026-07-01T00:00:00.000Z",
    );

    expect(next.coachingState.promptHashCounts.deadbeefdeadbeef).toBeUndefined();
  });

  it("throws when nowIso is not a valid timestamp", () => {
    expect(() =>
      recordCoachingHit(
        {
          coachingState: {
            promptHashCounts: {
              deadbeefdeadbeef: {
                count: 1,
                firstSeenIso: "2026-06-26T10:00:00.000Z",
                lastSeenIso: "2026-06-26T10:00:00.000Z",
                nagSessions: [],
                kind: COACHING_KIND_PROMPT_REPEAT,
              },
            },
          },
        },
        HASH_A,
        SESSION_A,
        "not-a-date",
      ),
    ).toThrow("nowIso must be a valid ISO timestamp");
  });

  it("preserves existing entry kind on a repeat hit", () => {
    const first = recordCoachingHit(
      defaultCaptureState(),
      HASH_A,
      SESSION_A,
      ISO_A,
      COACHING_KIND_ERROR_REPEAT,
    );
    const second = recordCoachingHit(first, HASH_A, SESSION_A, ISO_B, COACHING_KIND_PROMPT_REPEAT);
    expect(second.coachingState.promptHashCounts[HASH_A].kind).toBe(COACHING_KIND_ERROR_REPEAT);
  });

  it("falls back to passed kind when existing entry has an empty-string kind", () => {
    const next = recordCoachingHit(
      {
        coachingState: {
          promptHashCounts: {
            [HASH_A]: {
              count: 1,
              firstSeenIso: ISO_A,
              lastSeenIso: ISO_A,
              nagSessions: [],
              kind: "",
            },
          },
        },
      },
      HASH_A,
      SESSION_A,
      ISO_B,
      COACHING_KIND_ERROR_REPEAT,
    );
    expect(next.coachingState.promptHashCounts[HASH_A].kind).toBe(COACHING_KIND_ERROR_REPEAT);
  });
});

describe("assertIsoTimestamp (via openExchange and recordCoachingHit)", () => {
  it("accepts timezone-less local form", () => {
    expect(() => openExchange(defaultCaptureState(), "s1", "2026-07-09T10:00:00")).not.toThrow();
  });

  it("accepts full millisecond UTC form", () => {
    expect(() =>
      openExchange(defaultCaptureState(), "s1", "2026-07-09T10:00:00.123Z"),
    ).not.toThrow();
  });

  it("accepts bare-Z UTC form", () => {
    expect(() => openExchange(defaultCaptureState(), "s1", "2026-07-09T10:00:00Z")).not.toThrow();
  });

  it("rejects a non-date string", () => {
    expect(() => openExchange(defaultCaptureState(), "s1", "not-a-date")).toThrow(
      "nowIso must be a valid ISO timestamp",
    );
  });

  it("rejects out-of-range date parts", () => {
    expect(() => openExchange(defaultCaptureState(), "s1", "2026-13-40T99:99:99")).toThrow(
      "nowIso must be a valid ISO timestamp",
    );
  });
});

describe("shouldEmitCoachingNag", () => {
  const ISO_A = "2026-06-26T10:00:00.000Z";
  const SESSION_A = "session-a";
  const SESSION_B = "session-b";
  const HASH_A = "abcdef0123456789";

  const seedHits = (count) => {
    let state = defaultCaptureState();
    for (let i = 0; i < count; i++) {
      state = recordCoachingHit(state, HASH_A, SESSION_A, ISO_A);
    }
    return state;
  };

  it("returns false when entry missing", () => {
    expect(shouldEmitCoachingNag(defaultCaptureState(), HASH_A, SESSION_A)).toBe(false);
  });

  it("returns false below threshold", () => {
    const state = seedHits(COACHING_NAG_THRESHOLD - 1);
    expect(shouldEmitCoachingNag(state, HASH_A, SESSION_A)).toBe(false);
  });

  it("returns true at threshold and no prior nag for session", () => {
    const state = seedHits(COACHING_NAG_THRESHOLD);
    expect(shouldEmitCoachingNag(state, HASH_A, SESSION_A)).toBe(true);
  });

  it("returns false when session already nagged", () => {
    const state = markCoachingNagged(seedHits(COACHING_NAG_THRESHOLD), HASH_A, SESSION_A);
    expect(shouldEmitCoachingNag(state, HASH_A, SESSION_A)).toBe(false);
  });

  it("returns true for a different session even after nagging another", () => {
    const state = markCoachingNagged(seedHits(COACHING_NAG_THRESHOLD), HASH_A, SESSION_A);
    expect(shouldEmitCoachingNag(state, HASH_A, SESSION_B)).toBe(true);
  });

  it("returns true when nagSessions is not an array", () => {
    const state = {
      coachingState: {
        promptHashCounts: {
          [HASH_A]: {
            count: COACHING_NAG_THRESHOLD,
            firstSeenIso: ISO_A,
            lastSeenIso: ISO_A,
          },
        },
      },
    };
    expect(shouldEmitCoachingNag(state, HASH_A, SESSION_A)).toBe(true);
  });

  it("returns false when state has no coachingState", () => {
    expect(shouldEmitCoachingNag({ lastCapture: null }, HASH_A, SESSION_A)).toBe(false);
  });
});

describe("markCoachingNagged", () => {
  const ISO_A = "2026-06-26T10:00:00.000Z";
  const HASH_A = "abcdef0123456789";
  const HASH_MISSING = "00000000deadbeef";

  it("prepends sessionId and trims to memory cap", () => {
    let state = recordCoachingHit(defaultCaptureState(), HASH_A, "s1", ISO_A);
    state = markCoachingNagged(state, HASH_A, "s1");
    state = markCoachingNagged(state, HASH_A, "s2");
    state = markCoachingNagged(state, HASH_A, "s3");
    state = markCoachingNagged(state, HASH_A, "s4");
    expect(state.coachingState.promptHashCounts[HASH_A].nagSessions).toEqual(["s4", "s3", "s2"]);
    expect(state.coachingState.promptHashCounts[HASH_A].nagSessions.length).toBe(
      COACHING_NAG_SESSION_MEMORY,
    );
  });

  it("throws when entry does not exist", () => {
    expect(() => markCoachingNagged(defaultCaptureState(), HASH_MISSING, "s1")).toThrow();
  });

  it("uses empty nagSessions when entry.nagSessions is missing", () => {
    const state = {
      coachingState: {
        promptHashCounts: {
          [HASH_A]: { count: 1, firstSeenIso: ISO_A, lastSeenIso: ISO_A },
        },
      },
    };
    const next = markCoachingNagged(state, HASH_A, "s1");
    expect(next.coachingState.promptHashCounts[HASH_A].nagSessions).toEqual(["s1"]);
  });
});

describe("capture state persistence with coachingState", () => {
  it("round-trips coachingState through save/load", () => {
    const vaultPath = createTempVaultPath();
    const initial = recordCoachingHit(
      defaultCaptureState(),
      "abcdef0123456789",
      "session-a",
      "2026-06-26T10:00:00.000Z",
    );
    saveCaptureState(vaultPath, DEFAULT_SUBFOLDER, initial);
    const loaded = loadCaptureState(vaultPath, DEFAULT_SUBFOLDER);
    expect(loaded.coachingState.promptHashCounts.abcdef0123456789).toEqual({
      count: 1,
      firstSeenIso: "2026-06-26T10:00:00.000Z",
      lastSeenIso: "2026-06-26T10:00:00.000Z",
      nagSessions: [],
      kind: COACHING_KIND_PROMPT_REPEAT,
    });
  });

  it("returns empty coachingState when file missing", () => {
    const vaultPath = createTempVaultPath();
    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER).coachingState).toEqual({
      promptHashCounts: {},
    });
  });

  it("returns empty promptHashCounts when coachingState.promptHashCounts is not an object", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({ lastCapture: null, coachingState: { promptHashCounts: null } }),
      UTF8_ENCODING,
    );
    expect(loadCaptureState(vaultPath, DEFAULT_SUBFOLDER).coachingState).toEqual({
      promptHashCounts: {},
    });
  });

  it("filters out malformed coaching entries with various invalid fields", () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, DEFAULT_SUBFOLDER);
    const ISO = "2026-06-27T00:00:00.000Z";
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
        coachingState: {
          promptHashCounts: {
            e_null: null,
            e_non_integer_count: {
              count: 1.5,
              firstSeenIso: ISO,
              lastSeenIso: ISO,
              nagSessions: [],
            },
            e_zero_count: { count: 0, firstSeenIso: ISO, lastSeenIso: ISO, nagSessions: [] },
            e_non_string_first_iso: {
              count: 1,
              firstSeenIso: 123,
              lastSeenIso: ISO,
              nagSessions: [],
            },
            e_invalid_first_iso: {
              count: 1,
              firstSeenIso: "not-a-date",
              lastSeenIso: ISO,
              nagSessions: [],
            },
            e_invalid_last_iso: {
              count: 1,
              firstSeenIso: ISO,
              lastSeenIso: "not-a-date",
              nagSessions: [],
            },
            e_no_nag_array: { count: 1, firstSeenIso: ISO, lastSeenIso: ISO, nagSessions: "bad" },
            valid_entry: { count: 1, firstSeenIso: ISO, lastSeenIso: ISO, nagSessions: [] },
          },
        },
      }),
      UTF8_ENCODING,
    );
    const loaded = loadCaptureState(vaultPath, DEFAULT_SUBFOLDER);
    expect(Object.keys(loaded.coachingState.promptHashCounts)).toEqual(["valid_entry"]);
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
      coachingState: { promptHashCounts: {} },
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
      coachingState: { promptHashCounts: {} },
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
      coachingState: { promptHashCounts: {} },
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
      coachingState: { promptHashCounts: {} },
    });
  });
});

describe("exchange state management", () => {
  const SESSION_A = "session-a";
  const SESSION_B = "session-b";
  const ISO_NOW = new Date().toISOString();
  const ISO_STALE = new Date(Date.now() - EXCHANGE_STALE_OPEN_MS - ONE_SECOND_MS).toISOString();

  describe("isExchangeOpen", () => {
    it("returns false when state has no exchanges", () => {
      expect(isExchangeOpen(defaultCaptureState(), SESSION_A)).toBe(false);
    });

    it("returns false when session has no exchange entry", () => {
      const state = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      expect(isExchangeOpen(state, SESSION_B)).toBe(false);
    });

    it("returns true when exchange is open and not stale", () => {
      const state = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      expect(isExchangeOpen(state, SESSION_A)).toBe(true);
    });

    it("returns false when exchange is closed", () => {
      const opened = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      const closed = closeExchange(opened, SESSION_A);
      expect(isExchangeOpen(closed, SESSION_A)).toBe(false);
    });

    it("returns false when openedAtIso is older than EXCHANGE_STALE_OPEN_MS (24h stale-open)", () => {
      const state = openExchange(defaultCaptureState(), SESSION_A, ISO_STALE);
      expect(isExchangeOpen(state, SESSION_A)).toBe(false);
    });

    it("returns false when openedAtIso is not a valid date", () => {
      const state = {
        ...defaultCaptureState(),
        exchanges: { [SESSION_A]: { open: true, openedAtIso: "not-a-date" } },
      };
      expect(isExchangeOpen(state, SESSION_A)).toBe(false);
    });

    it("returns false when openedAtIso is not a string", () => {
      const state = {
        ...defaultCaptureState(),
        exchanges: { [SESSION_A]: { open: true, openedAtIso: 123 } },
      };
      expect(isExchangeOpen(state, SESSION_A)).toBe(false);
    });

    it("throws when state is not a plain object", () => {
      expect(() => isExchangeOpen(null, SESSION_A)).toThrow("state must be an object");
    });

    it("throws when sessionId is empty", () => {
      expect(() => isExchangeOpen(defaultCaptureState(), "")).toThrow(
        "sessionId must be a non-empty string",
      );
    });

    it("returns false when injected nowMs makes a fresh exchange appear stale", () => {
      const state = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      const farFutureMs = Date.now() + EXCHANGE_STALE_OPEN_MS + ONE_SECOND_MS;
      expect(isExchangeOpen(state, SESSION_A, farFutureMs)).toBe(false);
    });
  });

  describe("openExchange", () => {
    it("sets exchange open=true and stores openedAtIso", () => {
      const state = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      expect(state.exchanges[SESSION_A]).toEqual({ open: true, openedAtIso: ISO_NOW });
    });

    it("does not mutate original state", () => {
      const original = defaultCaptureState();
      openExchange(original, SESSION_A, ISO_NOW);
      expect(original.exchanges).toBeUndefined();
    });

    it("preserves other session exchanges", () => {
      const withA = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      const withAB = openExchange(withA, SESSION_B, ISO_NOW);
      expect(withAB.exchanges[SESSION_A]).toBeDefined();
      expect(withAB.exchanges[SESSION_B]).toBeDefined();
    });

    it("overwrites existing exchange for same session", () => {
      const first = openExchange(defaultCaptureState(), SESSION_A, "2026-01-01T00:00:00.000Z");
      const second = openExchange(first, SESSION_A, ISO_NOW);
      expect(second.exchanges[SESSION_A].openedAtIso).toBe(ISO_NOW);
    });

    it("throws when state is not a plain object", () => {
      expect(() => openExchange(null, SESSION_A, ISO_NOW)).toThrow("state must be an object");
    });

    it("throws when sessionId is empty", () => {
      expect(() => openExchange(defaultCaptureState(), "", ISO_NOW)).toThrow(
        "sessionId must be a non-empty string",
      );
    });

    it("throws when nowIso is empty", () => {
      expect(() => openExchange(defaultCaptureState(), SESSION_A, "")).toThrow(
        "nowIso must be a non-empty string",
      );
    });

    it("throws when nowIso is not a valid timestamp", () => {
      expect(() => openExchange(defaultCaptureState(), SESSION_A, "not-a-date")).toThrow(
        "nowIso must be a valid ISO timestamp",
      );
    });

    it("throws when nowIso is parseable but not ISO-shaped", () => {
      expect(() => openExchange(defaultCaptureState(), SESSION_A, "July 9, 2026")).toThrow(
        "nowIso must be a valid ISO timestamp",
      );
    });
  });

  describe("closeExchange", () => {
    it("removes the exchange entry so closed sessions do not accumulate", () => {
      const opened = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      const closed = closeExchange(opened, SESSION_A);
      expect(closed.exchanges).not.toHaveProperty(SESSION_A);
    });

    it("returns unchanged state when no exchange entry exists for session", () => {
      const state = defaultCaptureState();
      const result = closeExchange(state, SESSION_A);
      expect(result).toStrictEqual(state);
    });

    it("does not mutate original state", () => {
      const opened = openExchange(defaultCaptureState(), SESSION_A, ISO_NOW);
      const snapshot = JSON.stringify(opened);
      closeExchange(opened, SESSION_A);
      expect(JSON.stringify(opened)).toBe(snapshot);
    });

    it("preserves other session exchanges", () => {
      const withAB = openExchange(
        openExchange(defaultCaptureState(), SESSION_A, ISO_NOW),
        SESSION_B,
        ISO_NOW,
      );
      const closed = closeExchange(withAB, SESSION_A);
      expect(closed.exchanges[SESSION_B]).toEqual({ open: true, openedAtIso: ISO_NOW });
    });

    it("throws when state is not a plain object", () => {
      expect(() => closeExchange(null, SESSION_A)).toThrow("state must be an object");
    });

    it("throws when sessionId is empty", () => {
      expect(() => closeExchange(defaultCaptureState(), "")).toThrow(
        "sessionId must be a non-empty string",
      );
    });
  });
});
