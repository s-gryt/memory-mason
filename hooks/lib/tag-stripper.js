"use strict";

const { STRIP_TAGS, MAX_TAG_STRIP_COUNT } = require("./constants");
const { assertString } = require("./assert");

const ZERO = 0;
const EMPTY_STRING = "";

const buildTagRegex = (tagName) => new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "g");

/**
 * Remove supported Memory Mason privacy/system tags from a string.
 *
 * @param {string} content
 * @returns {string}
 */
function stripMemoryTags(content) {
  assertString("content", content);

  return STRIP_TAGS.reduce(
    (currentContent, tagName) => currentContent.replace(buildTagRegex(tagName), EMPTY_STRING),
    content,
  ).trim();
}

/**
 * Count the total number of removable tags present in a string.
 *
 * @param {string} content
 * @returns {number}
 */
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
