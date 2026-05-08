"use strict";

const { CAVEMAN_LITE_DROP_WORDS, CAVEMAN_LITE_DROP_PHRASES } = require("./constants");
const { assertString } = require("./assert");

const PLACEHOLDER_PREFIX = "\x00P";
const PLACEHOLDER_SUFFIX = "\x00";
const SINGLE_SPACE = " ";
const NEWLINE = "\n";
const VALIDATION_ERROR_MESSAGE = "compress validation failed: protected segment altered";
const HEADING_COUNT_ERROR_MESSAGE = "compress validation failed: heading count changed";
const BULLET_COUNT_ERROR_MESSAGE = "compress validation failed: bullet count outside tolerance";

const HEADING_LINE_PATTERN = /^#{1,6}\s/gm;
const BULLET_LINE_PATTERN = /^\s*[-*+]\s|^\s*\d+\.\s/gm;
const BULLET_VARIANCE = 0.15;

const PROTECTED_TYPE_CODE_BLOCK = "code_block";
const PROTECTED_TYPE_INLINE_CODE = "inline_code";
const PROTECTED_TYPE_URL = "url";
const PROTECTED_TYPE_DOUBLE_QUOTED = "double_quoted";
const PROTECTED_TYPE_SINGLE_QUOTED = "single_quoted";

const PROTECTED_PATTERNS = [
  {
    type: PROTECTED_TYPE_CODE_BLOCK,
    pattern: /```[\s\S]*?```/g,
  },
  {
    type: PROTECTED_TYPE_INLINE_CODE,
    pattern: /`[^`]*`/g,
  },
  {
    type: PROTECTED_TYPE_URL,
    pattern: /https?:\/\/[^\s)>"]+/g,
  },
  {
    type: PROTECTED_TYPE_DOUBLE_QUOTED,
    pattern: /"[^"\\]*(?:\\.[^"\\]*)*"/g,
  },
  {
    type: PROTECTED_TYPE_SINGLE_QUOTED,
    pattern: /'[^'\\]*(?:\\.[^'\\]*)*'/g,
  },
];

const buildPlaceholder = (index) => `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const extractProtectedSegments = (content) => {
  const protectedSegments = [];
  const protectedTypes = [];
  let result = content;

  for (const { type, pattern } of PROTECTED_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const index = protectedSegments.length;
      protectedSegments.push(match);
      protectedTypes.push(type);
      return buildPlaceholder(index);
    });
  }

  return { result, protectedSegments, protectedTypes };
};

const restoreProtectedSegments = (content, protectedSegments) => {
  let result = content;

  protectedSegments.forEach((originalSegment, index) => {
    result = result.replace(buildPlaceholder(index), originalSegment);
  });

  return result;
};

const validateProtectedSegments = (content, protectedSegments, protectedTypes) => {
  protectedSegments.forEach((originalSegment, index) => {
    const segmentType = protectedTypes[index];
    const isRequiredForValidation =
      segmentType === PROTECTED_TYPE_CODE_BLOCK || segmentType === PROTECTED_TYPE_URL;

    if (isRequiredForValidation && !content.includes(originalSegment)) {
      throw new Error(VALIDATION_ERROR_MESSAGE);
    }
  });
};

const countMatches = (content, pattern) => {
  const matches = content.match(pattern);
  return matches === null ? 0 : matches.length;
};

const validateStructure = (original, compressed) => {
  const originalHeadings = countMatches(original, HEADING_LINE_PATTERN);
  const compressedHeadings = countMatches(compressed, HEADING_LINE_PATTERN);

  if (originalHeadings !== compressedHeadings) {
    throw new Error(HEADING_COUNT_ERROR_MESSAGE);
  }

  const originalBullets = countMatches(original, BULLET_LINE_PATTERN);
  const compressedBullets = countMatches(compressed, BULLET_LINE_PATTERN);

  if (originalBullets === 0) {
    return;
  }

  const lowerBound = Math.floor(originalBullets * (1 - BULLET_VARIANCE));
  const upperBound = Math.ceil(originalBullets * (1 + BULLET_VARIANCE));

  if (compressedBullets < lowerBound || compressedBullets > upperBound) {
    throw new Error(BULLET_COUNT_ERROR_MESSAGE);
  }
};

/**
 * Apply caveman-lite compression to prose text.
 * Removes filler words and hedging phrases. Preserves code blocks,
 * inline code, URLs, quoted strings, and file paths unchanged.
 *
 * @param {string} content
 * @returns {string}
 */
function compressNarrativeText(content) {
  assertString("content", content);

  const extracted = extractProtectedSegments(content);
  let result = extracted.result;

  const sortedPhrases = [...CAVEMAN_LITE_DROP_PHRASES].sort(
    (leftPhrase, rightPhrase) => rightPhrase.length - leftPhrase.length,
  );

  for (const phrase of sortedPhrases) {
    result = result.replace(new RegExp(escapeRegex(phrase), "gi"), SINGLE_SPACE);
  }

  for (const word of CAVEMAN_LITE_DROP_WORDS) {
    result = result.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"), "");
  }

  result = result
    .split(NEWLINE)
    .map((line) => line.replace(/ {2,}/g, SINGLE_SPACE).trim())
    .join(NEWLINE);

  result = restoreProtectedSegments(result, extracted.protectedSegments);

  validateProtectedSegments(result, extracted.protectedSegments, extracted.protectedTypes);
  validateStructure(content, result);

  return result;
}

module.exports = { compressNarrativeText };
