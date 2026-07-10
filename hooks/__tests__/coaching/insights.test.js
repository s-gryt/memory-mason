"use strict";

const { COACHING_NAG_THRESHOLD } = require("../../lib/capture/constants");
const {
  selectTopCoachingInsights,
  formatCoachingAdditionalContext,
} = require("../../lib/coaching/insights");

const ISO_EARLY = "2026-06-26T08:00:00.000Z";
const ISO_MID = "2026-06-26T10:00:00.000Z";
const ISO_LATE = "2026-06-26T15:00:00.000Z";
const ISO_NOW = "2026-07-01T00:00:00.000Z";
const HIGH_COUNT = 12;
const MEDIUM_COUNT = 7;
const BELOW_THRESHOLD_COUNT = 2;
const LIMIT_THREE = 3;
const LIMIT_ONE = 1;
const LIMIT_ZERO = 0;

const buildEntry = (count, firstSeenIso, lastSeenIso, nagSessions = []) => ({
  count,
  firstSeenIso,
  lastSeenIso,
  nagSessions,
});

const buildState = (promptHashCounts) => ({
  coachingState: { promptHashCounts },
});

describe("selectTopCoachingInsights", () => {
  it("returns empty array when state has no coachingState", () => {
    expect(selectTopCoachingInsights({}, LIMIT_THREE)).toEqual([]);
  });

  it("returns empty array when promptHashCounts is missing", () => {
    expect(selectTopCoachingInsights({ coachingState: {} }, LIMIT_THREE)).toEqual([]);
  });

  it("filters out entries below COACHING_NAG_THRESHOLD", () => {
    const state = buildState({
      h1: buildEntry(BELOW_THRESHOLD_COUNT, ISO_EARLY, ISO_LATE),
      h2: buildEntry(COACHING_NAG_THRESHOLD, ISO_EARLY, ISO_LATE),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.length).toBe(1);
    expect(result[0].hash).toBe("h2");
  });

  it("sorts by count descending", () => {
    const state = buildState({
      h_med: buildEntry(MEDIUM_COUNT, ISO_EARLY, ISO_MID),
      h_high: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_MID),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.map((r) => r.hash)).toEqual(["h_high", "h_med"]);
  });

  it("breaks count ties by lastSeenIso descending", () => {
    const state = buildState({
      h_old: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_MID),
      h_new: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.map((r) => r.hash)).toEqual(["h_new", "h_old"]);
  });

  it("respects limit", () => {
    const state = buildState({
      h1: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_MID),
      h2: buildEntry(MEDIUM_COUNT, ISO_EARLY, ISO_MID),
      h3: buildEntry(COACHING_NAG_THRESHOLD, ISO_EARLY, ISO_MID),
    });
    expect(selectTopCoachingInsights(state, LIMIT_ONE).length).toBe(1);
    expect(selectTopCoachingInsights(state, LIMIT_ZERO).length).toBe(0);
  });

  it("each item shapes correctly, defaulting kind and snippet when absent", () => {
    const state = buildState({
      abcdef0123456789: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
    });
    const [item] = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(item).toEqual({
      hash: "abcdef0123456789",
      count: HIGH_COUNT,
      firstSeenIso: ISO_EARLY,
      lastSeenIso: ISO_LATE,
      kind: "prompt-repeat",
      snippet: "",
    });
  });

  it("preserves the entry's own kind and snippet when present", () => {
    const state = buildState({
      abcdef0123456789: {
        ...buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
        kind: "error-repeat",
        snippet: "build failed",
      },
    });
    const [item] = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(item.kind).toBe("error-repeat");
    expect(item.snippet).toBe("build failed");
  });

  it("throws on invalid state", () => {
    expect(() => selectTopCoachingInsights(null, LIMIT_THREE)).toThrow();
  });

  it("throws on negative limit", () => {
    const NEGATIVE = -1;
    expect(() => selectTopCoachingInsights({}, NEGATIVE)).toThrow();
  });

  it("filters out non-object entries and maps valid ones only", () => {
    const state = buildState({
      hash_null: null,
      hash_string: "invalid",
      abcdef0123456789: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.length).toBe(1);
    expect(result[0].hash).toBe("abcdef0123456789");
  });

  it("covers sort return 1: newer entry inserted first sorts before older", () => {
    const state = buildState({
      h_new: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
      h_old: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_MID),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.map((r) => r.hash)).toEqual(["h_new", "h_old"]);
  });

  it("preserves both entries when count and lastSeenIso are equal", () => {
    const state = buildState({
      h_a: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_MID),
      h_b: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_MID),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.length).toBe(2);
  });

  it("decays stale entries before ranking insights", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_NOW));

    const staleIso = "2026-03-01T00:00:00.000Z";
    const state = buildState({
      stale_high: buildEntry(HIGH_COUNT, staleIso, staleIso),
      fresh_medium: buildEntry(MEDIUM_COUNT, ISO_EARLY, ISO_LATE),
    });

    expect(selectTopCoachingInsights(state, LIMIT_THREE).map((item) => item.hash)).toEqual([
      "fresh_medium",
    ]);

    vi.useRealTimers();
  });

  it("excludes entry with unparseable lastSeenIso from output", () => {
    const state = buildState({
      corrupt: { count: HIGH_COUNT, firstSeenIso: ISO_EARLY, lastSeenIso: "not-a-date" },
      valid: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.map((r) => r.hash)).toEqual(["valid"]);
  });

  it("excludes entry with null lastSeenIso from output", () => {
    const state = buildState({
      corrupt: { count: HIGH_COUNT, firstSeenIso: ISO_EARLY, lastSeenIso: null },
      valid: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.map((r) => r.hash)).toEqual(["valid"]);
  });

  it("a genuinely fresh valid entry above threshold is still selected", () => {
    const state = buildState({
      fresh: buildEntry(HIGH_COUNT, ISO_EARLY, ISO_LATE),
    });
    const result = selectTopCoachingInsights(state, LIMIT_THREE);
    expect(result.length).toBe(1);
    expect(result[0].hash).toBe("fresh");
  });
});

describe("formatCoachingAdditionalContext", () => {
  it("returns empty string for empty array", () => {
    expect(formatCoachingAdditionalContext([])).toBe("");
  });

  it("throws when input is not an array", () => {
    expect(() => formatCoachingAdditionalContext(null)).toThrow();
    expect(() => formatCoachingAdditionalContext({})).toThrow();
  });

  it("renders block with header and bullets", () => {
    const result = formatCoachingAdditionalContext([
      {
        hash: "h1",
        count: HIGH_COUNT,
        firstSeenIso: ISO_EARLY,
        lastSeenIso: ISO_LATE,
        kind: "prompt-repeat",
      },
    ]);
    expect(result).toContain("## Workflow Coaching");
    expect(result).toContain("`h1`");
    expect(result).toContain(`**${HIGH_COUNT}x**`);
    expect(result).toContain("kind: prompt-repeat");
    expect(result).toContain(`first: ${ISO_EARLY}`);
    expect(result).toContain(`last: ${ISO_LATE}`);
  });

  it("appends the snippet in quotes when present", () => {
    const result = formatCoachingAdditionalContext([
      {
        hash: "h1",
        count: HIGH_COUNT,
        firstSeenIso: ISO_EARLY,
        lastSeenIso: ISO_LATE,
        kind: "prompt-repeat",
        snippet: "fix auth bug",
      },
    ]);
    expect(result).toContain('— "fix auth bug"');
  });

  it("omits the snippet suffix when absent", () => {
    const result = formatCoachingAdditionalContext([
      {
        hash: "h1",
        count: HIGH_COUNT,
        firstSeenIso: ISO_EARLY,
        lastSeenIso: ISO_LATE,
        kind: "prompt-repeat",
        snippet: "",
      },
    ]);
    expect(result).not.toContain('—  "');
  });

  it("skips non-object items", () => {
    const result = formatCoachingAdditionalContext([
      null,
      "string",
      {
        hash: "h_real",
        count: HIGH_COUNT,
        firstSeenIso: ISO_EARLY,
        lastSeenIso: ISO_LATE,
        kind: "prompt-repeat",
      },
    ]);
    expect(result).toContain("`h_real`");
    expect(result.split("\n").filter((line) => line.startsWith("- ")).length).toBe(1);
  });
});
