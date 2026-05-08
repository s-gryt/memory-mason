/**
 * This module handles tag stripper logic.
 */
"use strict";

const { STRIP_TAGS, MAX_TAG_STRIP_COUNT } = require("./constants");
const { assertString } = require("../shared/assert");

const ZERO = 0;
const EMPTY_STRING = "";

const buildTagRegex = (tagName) => new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "g");

function stripMemoryTags(content) {
  assertString("content", content);

  return STRIP_TAGS.reduce(
    (currentContent, tagName) => currentContent.replace(buildTagRegex(tagName), EMPTY_STRING),
    content,
  ).trim();
}

function countMemoryTags(content) {
  assertString("content", content);

  return STRIP_TAGS.reduce((totalCount, tagName) => {
    const matches = content.match(buildTagRegex(tagName));
    const matchCount = Array.isArray(matches) ? matches.length : ZERO;
    return totalCount + matchCount;
  }, ZERO);
}

module.exports = {
  stripMemoryTags,
  countMemoryTags,
  MAX_TAG_STRIP_COUNT,
};
