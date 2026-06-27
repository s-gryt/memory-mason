"use strict";

const { COACHING_NAG_THRESHOLD } = require("../../lib/capture/constants");
const {
  selectTopCoachingInsights,
  formatCoachingAdditionalContext,
} = require("../../lib/coaching/insights");

const ISO_EARLY = "2026-06-26T08:00:00.000Z";
const ISO_MID = "2026-06-26T10:00:00.000Z";
const ISO_LATE = "2026-06-26T15:00:00.000Z";
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

  it("each item shapes correctly", () => {
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
    });
  });

  it("throws on invalid state", () => {
    expect(() => selectTopCoachingInsights(null, LIMIT_THREE)).toThrow();
  });

  it("throws on negative limit", () => {
    const NEGATIVE = -1;
    expect(() => selectTopCoachingInsights({}, NEGATIVE)).toThrow();
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
