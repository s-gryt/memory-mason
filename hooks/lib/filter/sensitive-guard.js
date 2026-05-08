/**
 * This module handles sensitive guard logic.
 */
"use strict";

const { assertString } = require("../shared/assert");
const {
  SENSITIVE_FILE_NAMES,
  SENSITIVE_PATH_SEGMENTS,
  SENSITIVE_CONTENT_PATTERNS,
} = require("./constants");

const BACKSLASH_REGEX = /\\/g;
const FORWARD_SLASH = "/";
const ZERO = 0;
const FILE_NAME_REASON_PREFIX = "file-name:";
const PATH_SEGMENT_REASON_PREFIX = "path-segment:";
const CONTENT_PATTERN_REASON_PREFIX = "content-pattern:";

const toReason = (prefix, pattern) => `${prefix}${pattern}`;

const detectReasons = (safeContent, normalizedContent) => {
  const fileNameReasons = SENSITIVE_FILE_NAMES.filter((pattern) =>
    normalizedContent.includes(pattern),
  ).map((pattern) => toReason(FILE_NAME_REASON_PREFIX, pattern));

  const pathSegmentReasons = SENSITIVE_PATH_SEGMENTS.filter((pattern) =>
    normalizedContent.includes(pattern),
  ).map((pattern) => toReason(PATH_SEGMENT_REASON_PREFIX, pattern));

  const contentPatternReasons = SENSITIVE_CONTENT_PATTERNS.filter((pattern) =>
    safeContent.includes(pattern),
  ).map((pattern) => toReason(CONTENT_PATTERN_REASON_PREFIX, pattern));

  return [...new Set([...fileNameReasons, ...pathSegmentReasons, ...contentPatternReasons])];
};

function detectSensitiveContent(content) {
  const safeContent = assertString("content", content);
  const normalized = safeContent.replace(BACKSLASH_REGEX, FORWARD_SLASH);
  const reasons = detectReasons(safeContent, normalized);

  return { isSensitive: reasons.length > ZERO, reasons };
}

module.exports = { detectSensitiveContent };
