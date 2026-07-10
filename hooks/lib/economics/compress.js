/**
 * This module handles compress logic.
 */
"use strict";

const { assertString } = require("../shared/assert");

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
const PROTECTED_TYPE_INDENTED_CODE_BLOCK = "indented_code_block";
const PROTECTED_TYPE_INLINE_CODE = "inline_code";
const PROTECTED_TYPE_URL = "url";
const PROTECTED_TYPE_DOUBLE_QUOTED = "double_quoted";
const PROTECTED_TYPE_OPEN_DOUBLE_QUOTED = "open_double_quoted";
const PROTECTED_TYPE_SINGLE_QUOTED = "single_quoted";

const PROTECTED_PATTERNS = [
  {
    type: PROTECTED_TYPE_CODE_BLOCK,
    pattern: /```[\s\S]*?```/g,
  },
  {
    type: PROTECTED_TYPE_INDENTED_CODE_BLOCK,
    pattern: /^(?:[ ]{4}|\t)[^\n]*(?:\n(?:[ ]{4}|\t)[^\n]*)*/gm,
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
    pattern: /"[^"\n\\]*(?:\\.[^"\n\\]*)*"/g,
  },
  {
    type: PROTECTED_TYPE_OPEN_DOUBLE_QUOTED,
    pattern: /"[^"\n\\]*(?:\\.[^"\n\\]*)*$/gm,
  },
  {
    type: PROTECTED_TYPE_SINGLE_QUOTED,
    pattern: /(?<![A-Za-z0-9])'[^'\n\\]*(?:\\.[^'\n\\]*)*'(?![A-Za-z0-9])/g,
  },
];

const buildPlaceholder = (index) => `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;

const extractProtectedSegments = (content) => {
  const protectedSegments = [];
  let result = content;

  for (const { type, pattern } of PROTECTED_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const index = protectedSegments.length;
      const originalSegment =
        type === PROTECTED_TYPE_CODE_BLOCK || type === PROTECTED_TYPE_INDENTED_CODE_BLOCK
          ? match
          : restoreProtectedSegments(match, protectedSegments);
      protectedSegments.push(originalSegment);
      return buildPlaceholder(index);
    });
  }

  return { result, protectedSegments };
};

const restoreProtectedSegments = (content, protectedSegments) => {
  let result = content;

  for (let index = protectedSegments.length - 1; index >= 0; index -= 1) {
    result = result.replace(buildPlaceholder(index), () => protectedSegments[index]);
  }

  return result;
};

const countOccurrences = (haystack, needle) => {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
};

const validateProtectedSegments = (content, protectedSegments) => {
  const expectedCounts = new Map();
  for (const segment of protectedSegments) {
    if (expectedCounts.has(segment)) {
      expectedCounts.set(segment, expectedCounts.get(segment) + 1);
    } else {
      expectedCounts.set(segment, 1);
    }
  }
  for (const [segment, expected] of expectedCounts) {
    if (countOccurrences(content, segment) < expected) {
      throw new Error(VALIDATION_ERROR_MESSAGE);
    }
  }
};

const countMatches = (content, pattern) => {
  const matches = content.match(pattern);
  return matches === null ? 0 : matches.length;
};

const trimEachLine = (content) =>
  content
    .split(NEWLINE)
    .map((line) => line.trim())
    .join(NEWLINE);

const HARD_BREAK_LINE_PATTERN = /^(.*\S)( {2,})$/;
const LEADING_WHITESPACE_PATTERN = /^(\s*)/;
const STRUCTURED_LINE_PATTERN = /^(?:[-*+]\s|\d+\.\s|#{1,6}\s|>|\t|```)/;

const collapseLineWhitespace = (line) => {
  const rawLeadingWhitespace = line.match(LEADING_WHITESPACE_PATTERN)[1];
  const body = line.slice(rawLeadingWhitespace.length);
  const leadingWhitespace =
    rawLeadingWhitespace.length > 1 && !STRUCTURED_LINE_PATTERN.test(body)
      ? SINGLE_SPACE
      : rawLeadingWhitespace;
  const hardBreakMatch = body.match(HARD_BREAK_LINE_PATTERN);

  if (hardBreakMatch) {
    const collapsedBody = body
      .slice(0, body.length - hardBreakMatch[2].length)
      .replace(/ {2,}/g, SINGLE_SPACE)
      .trimEnd();
    return `${leadingWhitespace}${collapsedBody}  `;
  }

  return `${leadingWhitespace}${body.replace(/ {2,}/g, SINGLE_SPACE).trimEnd()}`;
};

const validateStructure = (maskedOriginal, maskedCompressed) => {
  const normalizedOriginal = trimEachLine(maskedOriginal);
  const normalizedCompressed = trimEachLine(maskedCompressed);
  const originalHeadings = countMatches(normalizedOriginal, HEADING_LINE_PATTERN);
  const compressedHeadings = countMatches(normalizedCompressed, HEADING_LINE_PATTERN);

  if (originalHeadings !== compressedHeadings) {
    throw new Error(HEADING_COUNT_ERROR_MESSAGE);
  }

  const originalBullets = countMatches(normalizedOriginal, BULLET_LINE_PATTERN);
  const compressedBullets = countMatches(normalizedCompressed, BULLET_LINE_PATTERN);

  if (originalBullets === 0) {
    return;
  }

  const lowerBound = Math.floor(originalBullets * (1 - BULLET_VARIANCE));
  const upperBound = Math.ceil(originalBullets * (1 + BULLET_VARIANCE));

  if (compressedBullets < lowerBound || compressedBullets > upperBound) {
    throw new Error(BULLET_COUNT_ERROR_MESSAGE);
  }
};

function compressNarrativeText(content) {
  assertString("content", content);

  const extracted = extractProtectedSegments(content);
  let result = extracted.result;

  result = result.split(NEWLINE).map(collapseLineWhitespace).join(NEWLINE);
  result = result.replace(/,\s+\./g, ".");
  result = result.replace(/^\s+([:;,.!?])/gm, "$1");

  validateStructure(extracted.result, result);

  result = restoreProtectedSegments(result, extracted.protectedSegments);

  validateProtectedSegments(result, extracted.protectedSegments);

  return result;
}

module.exports = { compressNarrativeText };
