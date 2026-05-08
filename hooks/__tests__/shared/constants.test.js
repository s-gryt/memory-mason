"use strict";

require("../../lib/shared/constants");
require("../../lib/hook/constants");
require("../../lib/config/constants");
require("../../lib/vault/constants");
require("../../lib/capture/constants");

const {
  STRIP_TAGS,
  MAX_TAG_STRIP_COUNT,
  META_TOOLS,
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
  PLAN_OUTPUT_TOOLS,
  AGENT_TOOLS,
  WRITE_TOOLS,
  BASH_TOOL_NAME,
  ERROR_PATTERNS,
  TEST_RESULT_PATTERNS,
  BASH_EXPLORATION_PATTERNS,
  SENSITIVE_FILE_NAMES,
  SENSITIVE_PATH_SEGMENTS,
  SENSITIVE_CONTENT_PATTERNS,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
} = require("../../lib/filter/constants");

const {
  TOKEN_CHARS_RATIO,
  MAX_NARRATIVE_TOKENS,
  MAX_NARRATIVE_CHARS,
  CAVEMAN_LITE_DROP_WORDS,
  CAVEMAN_LITE_DROP_PHRASES,
} = require("../../lib/economics/constants");

const ZERO = 0;
const EXPECTED_MAX_NARRATIVE_CHARS = 2000;
const EXPECTED_MAX_TAG_STRIP_COUNT = 100;
const EXPECTED_DISCOVERY_MIN_LINES = 20;
const EXPECTED_PLAN_PATH_PATTERN = ".claude/plans/";
const EXPECTED_BASH_TOOL_NAME = "bash";

const EXPECTED_META_TOOLS = ["Skill", "TodoWrite", "SlashCommand", "ListMcpResourcesTool"];

const EXPECTED_PLAN_OUTPUT_TOOLS = ["Write", "Edit"];
const EXPECTED_AGENT_TOOLS = ["Task", "Agent"];
const EXPECTED_WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "Create"];

const EXPECTED_STRIP_TAGS = [
  "system-reminder",
  "system-instruction",
  "private",
  "persisted-output",
  "claude-mem-context",
  "system_instruction",
];

const EXPECTED_EVENT_TYPES = {
  EVENT_TYPE_ERROR: "error",
  EVENT_TYPE_TEST_RESULT: "test_result",
  EVENT_TYPE_PLAN_OUTPUT: "plan_output",
  EVENT_TYPE_AGENT_RESULT: "agent_result",
  EVENT_TYPE_DISCOVERY: "discovery",
  EVENT_TYPE_DECISION: "decision",
  EVENT_TYPE_EXPLORATION: "exploration",
  EVENT_TYPE_META: "meta",
  EVENT_TYPE_NOISE: "noise",
};

const EXPECTED_ERROR_PATTERNS = ["Error:", "FAIL", "failed", "error:"];
const EXPECTED_TEST_RESULT_PATTERNS = [
  "tests passed",
  "tests failed",
  " passed",
  " failed",
  "assertion",
];
const EXPECTED_BASH_EXPLORATION_PATTERNS = ["ls", "cat ", "find ", "grep "];
const EXPECTED_ADDITIONAL_SENSITIVE_FILE_NAMES = [
  "passwords",
  ".pfx",
  ".crt",
  ".cer",
  ".jks",
  ".keystore",
  ".asc",
  ".gpg",
  "id_dsa",
  "id_ecdsa",
  "authorized_keys",
  "known_hosts",
];

const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

describe("constants phase 1 smart filtering", () => {
  it("derives MAX_NARRATIVE_CHARS from MAX_NARRATIVE_TOKENS and TOKEN_CHARS_RATIO", () => {
    expect(MAX_NARRATIVE_CHARS).toBe(MAX_NARRATIVE_TOKENS * TOKEN_CHARS_RATIO);
    expect(MAX_NARRATIVE_CHARS).toBe(EXPECTED_MAX_NARRATIVE_CHARS);
  });

  it("defines META_TOOLS with the exact expected members", () => {
    expect(Array.from(META_TOOLS)).toEqual(EXPECTED_META_TOOLS);
  });

  it("does not classify Read or Write as meta tools", () => {
    expect(META_TOOLS.has("Read")).toBe(false);
    expect(META_TOOLS.has("Write")).toBe(false);
  });

  it("defines PLAN_OUTPUT_TOOLS with Write and Edit only", () => {
    expect(Array.from(PLAN_OUTPUT_TOOLS)).toEqual(EXPECTED_PLAN_OUTPUT_TOOLS);
    expect(PLAN_OUTPUT_TOOLS.has("Read")).toBe(false);
  });

  it("defines AGENT_TOOLS for Task and Agent", () => {
    expect(Array.from(AGENT_TOOLS)).toEqual(EXPECTED_AGENT_TOOLS);
  });

  it("defines WRITE_TOOLS with all write-capable tool names", () => {
    expect(Array.from(WRITE_TOOLS)).toEqual(EXPECTED_WRITE_TOOLS);
  });

  it("defines STRIP_TAGS in the exact required order", () => {
    expect(STRIP_TAGS).toEqual(EXPECTED_STRIP_TAGS);
    expect(STRIP_TAGS).toHaveLength(EXPECTED_STRIP_TAGS.length);
  });

  it("defines CAVEMAN_LITE_DROP_WORDS as an array of strings", () => {
    expect(isStringArray(CAVEMAN_LITE_DROP_WORDS)).toBe(true);
  });

  it("defines CAVEMAN_LITE_DROP_PHRASES as an array of strings", () => {
    expect(isStringArray(CAVEMAN_LITE_DROP_PHRASES)).toBe(true);
  });

  it("defines sensitive-detection collections as arrays", () => {
    expect(Array.isArray(SENSITIVE_FILE_NAMES)).toBe(true);
    expect(Array.isArray(SENSITIVE_PATH_SEGMENTS)).toBe(true);
    expect(Array.isArray(SENSITIVE_CONTENT_PATTERNS)).toBe(true);
  });

  it("includes expanded sensitive filename coverage for key and certificate artifacts", () => {
    expect(SENSITIVE_FILE_NAMES).toEqual(
      expect.arrayContaining(EXPECTED_ADDITIONAL_SENSITIVE_FILE_NAMES),
    );
  });

  it("defines warning prefixes as non-empty strings", () => {
    expect(typeof HOOK_WARNING_TAG_LIMIT_PREFIX).toBe("string");
    expect(typeof HOOK_WARNING_SENSITIVE_SKIP_PREFIX).toBe("string");
    expect(HOOK_WARNING_TAG_LIMIT_PREFIX.length).toBeGreaterThan(ZERO);
    expect(HOOK_WARNING_SENSITIVE_SKIP_PREFIX.length).toBeGreaterThan(ZERO);
  });

  it("defines all remaining classification constants with expected values", () => {
    expect(MAX_TAG_STRIP_COUNT).toBe(EXPECTED_MAX_TAG_STRIP_COUNT);
    expect(DISCOVERY_MIN_LINES).toBe(EXPECTED_DISCOVERY_MIN_LINES);
    expect(PLAN_PATH_PATTERN).toBe(EXPECTED_PLAN_PATH_PATTERN);
    expect(BASH_TOOL_NAME).toBe(EXPECTED_BASH_TOOL_NAME);

    expect(EVENT_TYPE_ERROR).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_ERROR);
    expect(EVENT_TYPE_TEST_RESULT).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_TEST_RESULT);
    expect(EVENT_TYPE_PLAN_OUTPUT).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_PLAN_OUTPUT);
    expect(EVENT_TYPE_AGENT_RESULT).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_AGENT_RESULT);
    expect(EVENT_TYPE_DISCOVERY).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_DISCOVERY);
    expect(EVENT_TYPE_DECISION).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_DECISION);
    expect(EVENT_TYPE_EXPLORATION).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_EXPLORATION);
    expect(EVENT_TYPE_META).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_META);
    expect(EVENT_TYPE_NOISE).toBe(EXPECTED_EVENT_TYPES.EVENT_TYPE_NOISE);

    expect(ERROR_PATTERNS).toEqual(EXPECTED_ERROR_PATTERNS);
    expect(TEST_RESULT_PATTERNS).toEqual(EXPECTED_TEST_RESULT_PATTERNS);
    expect(BASH_EXPLORATION_PATTERNS).toEqual(EXPECTED_BASH_EXPLORATION_PATTERNS);
  });
});
