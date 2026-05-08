"use strict";

const { isObjectRecord, assertNonEmptyString } = require("./assert");
const { TOKEN_CHARS_RATIO } = require("./constants");

const ZERO = 0;
const EMPTY_STRING = "";
const NULL_VALUE = null;
const PERCENT_BASE = 100;

const toText = (value) => (typeof value === "string" ? value : EMPTY_STRING);

const toIntegerOrDefault = (value, fallback = ZERO) => (Number.isInteger(value) ? value : fallback);

const toNullableString = (value) =>
  typeof value === "string" && value !== "" ? value : NULL_VALUE;

const estimateTokenCount = (content) => {
  const safeContent = toText(content);

  if (safeContent === EMPTY_STRING) {
    return ZERO;
  }

  return Math.ceil(safeContent.length / TOKEN_CHARS_RATIO);
};

const estimateTokensFromCharacterCount = (characterCount) => {
  const safeCharacterCount = toIntegerOrDefault(characterCount);

  if (safeCharacterCount === ZERO) {
    return ZERO;
  }

  return Math.ceil(safeCharacterCount / TOKEN_CHARS_RATIO);
};

const calculateSavingsPercent = (rawTokens, storedTokens) => {
  const safeRawTokens = toIntegerOrDefault(rawTokens);
  const safeStoredTokens = toIntegerOrDefault(storedTokens);

  if (safeRawTokens === ZERO) {
    return ZERO;
  }

  return Math.round(((safeRawTokens - safeStoredTokens) / safeRawTokens) * PERCENT_BASE);
};

const buildTokenEconomics = (rawContent, storedContent) => {
  const safeRawContent = toText(rawContent);
  const safeStoredContent = toText(storedContent);
  const rawChars = safeRawContent.length;
  const storedChars = safeStoredContent.length;
  const rawTokens = estimateTokenCount(safeRawContent);
  const storedTokens = estimateTokenCount(safeStoredContent);

  return {
    raw_chars: rawChars,
    stored_chars: storedChars,
    raw_tokens: rawTokens,
    stored_tokens: storedTokens,
    savings_chars: rawChars - storedChars,
    savings_tokens: rawTokens - storedTokens,
    savings_percent: calculateSavingsPercent(rawTokens, storedTokens),
  };
};

const defaultCaptureMetrics = () => ({
  capture_count: ZERO,
  total_raw_chars: ZERO,
  total_stored_chars: ZERO,
  total_raw_tokens: ZERO,
  total_stored_tokens: ZERO,
  total_savings_chars: ZERO,
  total_savings_tokens: ZERO,
  total_savings_percent: ZERO,
  last_capture_at: NULL_VALUE,
  last_capture: NULL_VALUE,
});

const normalizeCaptureSnapshot = (snapshot) => {
  if (!isObjectRecord(snapshot)) {
    return NULL_VALUE;
  }

  const rawChars = toIntegerOrDefault(snapshot.raw_chars);
  const storedChars = toIntegerOrDefault(snapshot.stored_chars);
  const rawTokens = toIntegerOrDefault(
    snapshot.raw_tokens,
    estimateTokensFromCharacterCount(rawChars),
  );
  const storedTokens = toIntegerOrDefault(
    snapshot.stored_tokens,
    estimateTokensFromCharacterCount(storedChars),
  );
  const source = toNullableString(snapshot.source);
  const capturedAt = toNullableString(snapshot.captured_at);

  if (source === NULL_VALUE || capturedAt === NULL_VALUE) {
    return NULL_VALUE;
  }

  return {
    source,
    captured_at: capturedAt,
    raw_chars: rawChars,
    stored_chars: storedChars,
    raw_tokens: rawTokens,
    stored_tokens: storedTokens,
    savings_chars: rawChars - storedChars,
    savings_tokens: rawTokens - storedTokens,
    savings_percent: calculateSavingsPercent(rawTokens, storedTokens),
  };
};

const normalizeCaptureMetrics = (captureMetrics) => {
  if (!isObjectRecord(captureMetrics)) {
    return defaultCaptureMetrics();
  }

  const totalRawChars = toIntegerOrDefault(captureMetrics.total_raw_chars);
  const totalStoredChars = toIntegerOrDefault(captureMetrics.total_stored_chars);
  const totalRawTokens = toIntegerOrDefault(
    captureMetrics.total_raw_tokens,
    estimateTokensFromCharacterCount(totalRawChars),
  );
  const totalStoredTokens = toIntegerOrDefault(
    captureMetrics.total_stored_tokens,
    estimateTokensFromCharacterCount(totalStoredChars),
  );

  return {
    capture_count: toIntegerOrDefault(captureMetrics.capture_count),
    total_raw_chars: totalRawChars,
    total_stored_chars: totalStoredChars,
    total_raw_tokens: totalRawTokens,
    total_stored_tokens: totalStoredTokens,
    total_savings_chars: totalRawChars - totalStoredChars,
    total_savings_tokens: totalRawTokens - totalStoredTokens,
    total_savings_percent: calculateSavingsPercent(totalRawTokens, totalStoredTokens),
    last_capture_at: toNullableString(captureMetrics.last_capture_at),
    last_capture: normalizeCaptureSnapshot(captureMetrics.last_capture),
  };
};

const accumulateCaptureMetrics = (
  captureMetrics,
  source,
  capturedAt,
  rawContent,
  storedContent,
) => {
  const safeSource = assertNonEmptyString("source", source);
  const safeCapturedAt = assertNonEmptyString("capturedAt", capturedAt);
  const currentMetrics = normalizeCaptureMetrics(captureMetrics);
  const nextEconomics = buildTokenEconomics(rawContent, storedContent);
  const totalRawChars = currentMetrics.total_raw_chars + nextEconomics.raw_chars;
  const totalStoredChars = currentMetrics.total_stored_chars + nextEconomics.stored_chars;
  const totalRawTokens = currentMetrics.total_raw_tokens + nextEconomics.raw_tokens;
  const totalStoredTokens = currentMetrics.total_stored_tokens + nextEconomics.stored_tokens;

  return {
    capture_count: currentMetrics.capture_count + 1,
    total_raw_chars: totalRawChars,
    total_stored_chars: totalStoredChars,
    total_raw_tokens: totalRawTokens,
    total_stored_tokens: totalStoredTokens,
    total_savings_chars: totalRawChars - totalStoredChars,
    total_savings_tokens: totalRawTokens - totalStoredTokens,
    total_savings_percent: calculateSavingsPercent(totalRawTokens, totalStoredTokens),
    last_capture_at: safeCapturedAt,
    last_capture: {
      source: safeSource,
      captured_at: safeCapturedAt,
      ...nextEconomics,
    },
  };
};

module.exports = {
  estimateTokenCount,
  estimateTokensFromCharacterCount,
  calculateSavingsPercent,
  buildTokenEconomics,
  defaultCaptureMetrics,
  normalizeCaptureMetrics,
  accumulateCaptureMetrics,
};
