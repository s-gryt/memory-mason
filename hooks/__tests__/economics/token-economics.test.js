"use strict";

const {
  estimateTokenCount,
  estimateTokensFromCharacterCount,
  calculateSavingsPercent,
  buildTokenEconomics,
  defaultCaptureMetrics,
  normalizeCaptureMetrics,
  accumulateCaptureMetrics,
} = require("../../lib/economics/token-economics");

const EMPTY_STRING = "";
const SOURCE_POST_TOOL_USE = "post-tool-use";
const SOURCE_PRE_COMPACT = "pre-compact";
const TIMESTAMP_ONE = "2026-05-07T10:00:00";
const TIMESTAMP_TWO = "2026-05-07T11:00:00";
const TEXT_FOUR = "1234";
const TEXT_FIVE = "12345";
const TEXT_EIGHT = "12345678";
const TEXT_TEN = "1234567890";
const TEXT_TWELVE = "12";
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FOUR = 4;
const FIVE = 5;
const SIX = 6;
const EIGHT = 8;
const NINE = 9;
const TEN = 10;
const ELEVEN = 11;
const TWELVE = 12;
const EIGHTEEN = 18;
const THIRTY_THREE = 33;
const FORTY_FOUR = 44;
const FIFTY = 50;
const SIXTY = 60;
const SIXTY_SEVEN = 67;
const SEVENTY_FIVE = 75;
const NINE_HUNDRED_NINETY_NINE = 999;
const NEGATIVE_TWENTY_FIVE = -25;
const INVALID_CAPTURE_TIMESTAMP = 123;

describe("estimateTokenCount", () => {
  it("returns zero for empty content", () => {
    expect(estimateTokenCount(EMPTY_STRING)).toBe(ZERO);
  });

  it("rounds character counts up using the configured ratio", () => {
    expect(estimateTokenCount(TEXT_FIVE)).toBe(TWO);
  });

  it("treats non-string input as empty content", () => {
    expect(estimateTokenCount(null)).toBe(ZERO);
  });
});

describe("estimateTokensFromCharacterCount", () => {
  it("returns zero for zero characters", () => {
    expect(estimateTokensFromCharacterCount(ZERO)).toBe(ZERO);
  });

  it("rounds character counts up using the configured ratio", () => {
    expect(estimateTokensFromCharacterCount(FIVE)).toBe(TWO);
  });

  it("treats invalid counts as zero", () => {
    expect(estimateTokensFromCharacterCount(null)).toBe(ZERO);
  });
});

describe("calculateSavingsPercent", () => {
  it("returns zero when raw token count is zero", () => {
    expect(calculateSavingsPercent(ZERO, THREE)).toBe(ZERO);
  });

  it("rounds savings percentage to the nearest integer", () => {
    expect(calculateSavingsPercent(NINE, FIVE)).toBe(FORTY_FOUR);
  });

  it("supports negative savings percentages", () => {
    expect(calculateSavingsPercent(FOUR, FIVE)).toBe(NEGATIVE_TWENTY_FIVE);
  });
});

describe("buildTokenEconomics", () => {
  it("builds raw, stored, and savings metrics", () => {
    expect(buildTokenEconomics(TEXT_EIGHT, TEXT_FOUR)).toEqual({
      raw_chars: EIGHT,
      stored_chars: FOUR,
      raw_tokens: TWO,
      stored_tokens: ONE,
      savings_chars: FOUR,
      savings_tokens: ONE,
      savings_percent: FIFTY,
    });
  });

  it("treats non-string input as empty content", () => {
    expect(buildTokenEconomics(null, undefined)).toEqual({
      raw_chars: ZERO,
      stored_chars: ZERO,
      raw_tokens: ZERO,
      stored_tokens: ZERO,
      savings_chars: ZERO,
      savings_tokens: ZERO,
      savings_percent: ZERO,
    });
  });
});

describe("defaultCaptureMetrics", () => {
  it("returns zeroed metrics with no last capture", () => {
    expect(defaultCaptureMetrics()).toEqual({
      capture_count: ZERO,
      total_raw_chars: ZERO,
      total_stored_chars: ZERO,
      total_raw_tokens: ZERO,
      total_stored_tokens: ZERO,
      total_savings_chars: ZERO,
      total_savings_tokens: ZERO,
      total_savings_percent: ZERO,
      last_capture_at: null,
      last_capture: null,
    });
  });
});

describe("normalizeCaptureMetrics", () => {
  it("returns defaults for invalid capture metrics", () => {
    expect(normalizeCaptureMetrics([])).toEqual(defaultCaptureMetrics());
  });

  it("recomputes totals and invalid snapshot fields", () => {
    expect(
      normalizeCaptureMetrics({
        capture_count: TWO,
        total_raw_chars: ELEVEN,
        total_stored_chars: THREE,
        total_raw_tokens: FOUR,
        total_stored_tokens: ONE,
        total_savings_chars: NINE_HUNDRED_NINETY_NINE,
        total_savings_tokens: NINE_HUNDRED_NINETY_NINE,
        total_savings_percent: NINE_HUNDRED_NINETY_NINE,
        last_capture_at: TIMESTAMP_ONE,
        last_capture: {
          source: SOURCE_POST_TOOL_USE,
          captured_at: TIMESTAMP_ONE,
          raw_chars: EIGHT,
          stored_chars: FOUR,
          raw_tokens: TWO,
          stored_tokens: ONE,
          savings_chars: ZERO,
          savings_tokens: ZERO,
          savings_percent: ZERO,
        },
      }),
    ).toEqual({
      capture_count: TWO,
      total_raw_chars: ELEVEN,
      total_stored_chars: THREE,
      total_raw_tokens: FOUR,
      total_stored_tokens: ONE,
      total_savings_chars: EIGHT,
      total_savings_tokens: THREE,
      total_savings_percent: SEVENTY_FIVE,
      last_capture_at: TIMESTAMP_ONE,
      last_capture: {
        source: SOURCE_POST_TOOL_USE,
        captured_at: TIMESTAMP_ONE,
        raw_chars: EIGHT,
        stored_chars: FOUR,
        raw_tokens: TWO,
        stored_tokens: ONE,
        savings_chars: FOUR,
        savings_tokens: ONE,
        savings_percent: FIFTY,
      },
    });
  });

  it("drops invalid last capture payloads", () => {
    expect(
      normalizeCaptureMetrics({
        capture_count: ONE,
        total_raw_chars: FOUR,
        total_stored_chars: TWO,
        total_raw_tokens: ONE,
        total_stored_tokens: ONE,
        last_capture_at: INVALID_CAPTURE_TIMESTAMP,
        last_capture: { raw_chars: FOUR },
      }),
    ).toEqual({
      capture_count: ONE,
      total_raw_chars: FOUR,
      total_stored_chars: TWO,
      total_raw_tokens: ONE,
      total_stored_tokens: ONE,
      total_savings_chars: TWO,
      total_savings_tokens: ZERO,
      total_savings_percent: ZERO,
      last_capture_at: null,
      last_capture: null,
    });
  });

  it("derives token counts from character totals when token totals are missing", () => {
    expect(
      normalizeCaptureMetrics({
        capture_count: ONE,
        total_raw_chars: NINE,
        total_stored_chars: FIVE,
        last_capture_at: TIMESTAMP_ONE,
        last_capture: {
          source: SOURCE_POST_TOOL_USE,
          captured_at: TIMESTAMP_ONE,
          raw_chars: NINE,
          stored_chars: FIVE,
        },
      }),
    ).toEqual({
      capture_count: ONE,
      total_raw_chars: NINE,
      total_stored_chars: FIVE,
      total_raw_tokens: THREE,
      total_stored_tokens: TWO,
      total_savings_chars: FOUR,
      total_savings_tokens: ONE,
      total_savings_percent: THIRTY_THREE,
      last_capture_at: TIMESTAMP_ONE,
      last_capture: {
        source: SOURCE_POST_TOOL_USE,
        captured_at: TIMESTAMP_ONE,
        raw_chars: NINE,
        stored_chars: FIVE,
        raw_tokens: THREE,
        stored_tokens: TWO,
        savings_chars: FOUR,
        savings_tokens: ONE,
        savings_percent: THIRTY_THREE,
      },
    });
  });
});

describe("accumulateCaptureMetrics", () => {
  it("adds a new capture to totals and stores the latest snapshot", () => {
    expect(
      accumulateCaptureMetrics(
        defaultCaptureMetrics(),
        SOURCE_POST_TOOL_USE,
        TIMESTAMP_ONE,
        TEXT_EIGHT,
        TEXT_FOUR,
      ),
    ).toEqual({
      capture_count: ONE,
      total_raw_chars: EIGHT,
      total_stored_chars: FOUR,
      total_raw_tokens: TWO,
      total_stored_tokens: ONE,
      total_savings_chars: FOUR,
      total_savings_tokens: ONE,
      total_savings_percent: FIFTY,
      last_capture_at: TIMESTAMP_ONE,
      last_capture: {
        source: SOURCE_POST_TOOL_USE,
        captured_at: TIMESTAMP_ONE,
        raw_chars: EIGHT,
        stored_chars: FOUR,
        raw_tokens: TWO,
        stored_tokens: ONE,
        savings_chars: FOUR,
        savings_tokens: ONE,
        savings_percent: FIFTY,
      },
    });
  });

  it("accumulates on top of normalized existing totals", () => {
    expect(
      accumulateCaptureMetrics(
        {
          capture_count: ONE,
          total_raw_chars: EIGHT,
          total_stored_chars: FOUR,
          total_raw_tokens: TWO,
          total_stored_tokens: ONE,
          last_capture_at: TIMESTAMP_ONE,
          last_capture: {
            source: SOURCE_POST_TOOL_USE,
            captured_at: TIMESTAMP_ONE,
            raw_chars: EIGHT,
            stored_chars: FOUR,
            raw_tokens: TWO,
            stored_tokens: ONE,
          },
        },
        SOURCE_PRE_COMPACT,
        TIMESTAMP_TWO,
        TEXT_TEN,
        TEXT_TWELVE,
      ),
    ).toEqual({
      capture_count: TWO,
      total_raw_chars: EIGHTEEN,
      total_stored_chars: SIX,
      total_raw_tokens: FIVE,
      total_stored_tokens: TWO,
      total_savings_chars: TWELVE,
      total_savings_tokens: THREE,
      total_savings_percent: SIXTY,
      last_capture_at: TIMESTAMP_TWO,
      last_capture: {
        source: SOURCE_PRE_COMPACT,
        captured_at: TIMESTAMP_TWO,
        raw_chars: TEN,
        stored_chars: TWO,
        raw_tokens: THREE,
        stored_tokens: ONE,
        savings_chars: EIGHT,
        savings_tokens: TWO,
        savings_percent: SIXTY_SEVEN,
      },
    });
  });

  it("throws when source is empty", () => {
    expect(() =>
      accumulateCaptureMetrics(
        defaultCaptureMetrics(),
        EMPTY_STRING,
        TIMESTAMP_ONE,
        TEXT_FOUR,
        TEXT_TWELVE,
      ),
    ).toThrow("source must be a non-empty string");
  });

  it("throws when capturedAt is empty", () => {
    expect(() =>
      accumulateCaptureMetrics(
        defaultCaptureMetrics(),
        SOURCE_POST_TOOL_USE,
        EMPTY_STRING,
        TEXT_FOUR,
        TEXT_TWELVE,
      ),
    ).toThrow("capturedAt must be a non-empty string");
  });
});
