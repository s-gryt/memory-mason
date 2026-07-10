/**
 * This module handles capture ops logic.
 */
"use strict";

const { localNow } = require("../vault/vault");
const { MAX_TAG_STRIP_COUNT } = require("../filter/constants");
const { HOOK_WARNING_TAG_LIMIT_PREFIX } = require("../filter/constants");

const EMPTY_STRING = "";
const NEWLINE = "\n";
const HOOK_WARNING_FILTER_FALLBACK_PREFIX =
  "[memory-mason] capture filter failed; using uncompressed sanitized transcript";

const buildCaptureTimestamp = () => {
  const now = localNow();
  return {
    today: now.date,
    timestamp: now.time,
    iso: `${now.date}T${now.time}`,
  };
};

const buildTagWarning = (tagCount) => {
  if (tagCount <= MAX_TAG_STRIP_COUNT) {
    return EMPTY_STRING;
  }
  return `${HOOK_WARNING_TAG_LIMIT_PREFIX}: ${tagCount} tags found${NEWLINE}`;
};

const buildWarningsResult = (
  tagWarning,
  filterWarning = EMPTY_STRING,
  extraWarning = EMPTY_STRING,
) => {
  const { buildSuccessResult } = require("./hook-runtime");
  const warnings = `${tagWarning}${filterWarning}${extraWarning}`;
  const result = buildSuccessResult();
  return warnings === EMPTY_STRING ? result : { ...result, stderr: warnings };
};

module.exports = {
  buildCaptureTimestamp,
  buildTagWarning,
  buildWarningsResult,
  HOOK_WARNING_FILTER_FALLBACK_PREFIX,
};
