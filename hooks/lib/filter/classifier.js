/**
 * This module handles classifier logic.
 */
"use strict";

const { stripVTControlCharacters } = require("node:util");
const { assertObjectRecord } = require("../shared/assert");
const {
  USER_INPUT_TOOLS,
  NOISY_TOOLS,
  META_TOOLS,
  PLAN_OUTPUT_TOOLS,
  AGENT_TOOLS,
  WRITE_TOOLS,
  BASH_TOOL_NAME,
  EVENT_TYPE_ERROR,
  EVENT_TYPE_TEST_RESULT,
  EVENT_TYPE_PLAN_OUTPUT,
  EVENT_TYPE_AGENT_RESULT,
  EVENT_TYPE_DISCOVERY,
  EVENT_TYPE_DECISION,
  EVENT_TYPE_EXPLORATION,
  EVENT_TYPE_META,
  EVENT_TYPE_NOISE,
  DISCOVERY_MIN_LINES,
  PLAN_PATH_PATTERN,
  ERROR_PATTERNS,
  TEST_RESULT_PATTERNS,
  BASH_EXPLORATION_PATTERNS,
} = require("./constants");
const { stripMemoryTags } = require("./tag-stripper");

const EMPTY_STRING = "";
const ZERO = 0;
const NULL_VALUE = null;
const PATH_SEPARATOR_PATTERN = /\\/g;
const PATH_SEPARATOR = "/";

const toSafeString = (value) => (typeof value === "string" ? value : EMPTY_STRING);

const normalizeExitCode = (value) => (typeof value === "number" ? value : NULL_VALUE);

const normalizeLineCount = (value) => (Number.isInteger(value) && value >= ZERO ? value : ZERO);

const hasAnyPattern = (content, patterns) => patterns.some((pattern) => content.includes(pattern));

const isNoiseContent = (output) => {
  const withoutAnsi = stripVTControlCharacters(output).trim();
  const withoutMemoryTags = stripMemoryTags(withoutAnsi).trim();
  return withoutMemoryTags === EMPTY_STRING;
};

const isBashExploration = (toolName, commandText) =>
  toolName.toLowerCase() === BASH_TOOL_NAME &&
  BASH_EXPLORATION_PATTERNS.some((pattern) => commandText.toLowerCase().includes(pattern));

const EVENT_CLASSIFIERS = [
  {
    eventType: EVENT_TYPE_TEST_RESULT,
    matches: ({ output }) => hasAnyPattern(output, TEST_RESULT_PATTERNS),
  },
  {
    eventType: EVENT_TYPE_ERROR,
    matches: ({ output, exitCode }) =>
      (exitCode !== NULL_VALUE && exitCode !== ZERO) || hasAnyPattern(output, ERROR_PATTERNS),
  },
  {
    eventType: EVENT_TYPE_NOISE,
    matches: ({ output }) => isNoiseContent(output),
  },
  {
    eventType: EVENT_TYPE_PLAN_OUTPUT,
    matches: ({ toolName, normalizedFilePath }) =>
      PLAN_OUTPUT_TOOLS.has(toolName) && normalizedFilePath.includes(PLAN_PATH_PATTERN),
  },
  {
    eventType: EVENT_TYPE_AGENT_RESULT,
    matches: ({ toolName }) => AGENT_TOOLS.has(toolName),
  },
  {
    eventType: EVENT_TYPE_DISCOVERY,
    matches: ({ toolName, lineCount }) =>
      WRITE_TOOLS.has(toolName) && lineCount > DISCOVERY_MIN_LINES,
  },
  {
    eventType: EVENT_TYPE_DECISION,
    matches: ({ toolName }) => USER_INPUT_TOOLS.has(toolName),
  },
  {
    eventType: EVENT_TYPE_EXPLORATION,
    matches: ({ toolName, commandText }) =>
      NOISY_TOOLS.has(toolName) || isBashExploration(toolName, commandText),
  },
  {
    eventType: EVENT_TYPE_META,
    matches: ({ toolName }) => META_TOOLS.has(toolName),
  },
];

function classifyToolEvent(input) {
  assertObjectRecord("input", input);

  const toolName = toSafeString(input.toolName);
  const output = toSafeString(input.output);
  const normalizedFilePath = toSafeString(input.filePath).replace(
    PATH_SEPARATOR_PATTERN,
    PATH_SEPARATOR,
  );
  const commandText = toSafeString(input.commandText);
  const exitCode = normalizeExitCode(input.exitCode);
  const lineCount = normalizeLineCount(input.lineCount);

  const eventInput = {
    toolName,
    output,
    normalizedFilePath,
    commandText,
    exitCode,
    lineCount,
  };

  const matchedClassifier = EVENT_CLASSIFIERS.find((classifier) => classifier.matches(eventInput));
  if (typeof matchedClassifier === "object") {
    return matchedClassifier.eventType;
  }

  return EVENT_TYPE_NOISE;
}

module.exports = { classifyToolEvent };
