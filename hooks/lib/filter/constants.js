/**
 * This module handles constants logic.
 */
"use strict";

const USER_INPUT_TOOLS = new Set(["AskUserQuestion"]);
const NOISY_TOOLS = new Set(["Read", "Glob", "LS", "List", "ls", "read", "glob"]);

const STRIP_TAGS = [
  "system-reminder",
  "system-instruction",
  "private",
  "persisted-output",
  "claude-mem-context",
  "system_instruction",
];

const MAX_TAG_STRIP_COUNT = 100;

const META_TOOLS = new Set(["Skill", "TodoWrite", "SlashCommand", "ListMcpResourcesTool"]);

const EVENT_TYPE_ERROR = "error";
const EVENT_TYPE_TEST_RESULT = "test_result";
const EVENT_TYPE_PLAN_OUTPUT = "plan_output";
const EVENT_TYPE_AGENT_RESULT = "agent_result";
const EVENT_TYPE_DISCOVERY = "discovery";
const EVENT_TYPE_DECISION = "decision";
const EVENT_TYPE_EXPLORATION = "exploration";
const EVENT_TYPE_META = "meta";
const EVENT_TYPE_NOISE = "noise";

const DISCOVERY_MIN_LINES = 20;
const PLAN_PATH_PATTERN = ".claude/plans/";

const PLAN_OUTPUT_TOOLS = new Set(["Write", "Edit"]);
const AGENT_TOOLS = new Set(["Task", "Agent"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "Create"]);

const BASH_TOOL_NAME = "bash";
const ERROR_PATTERNS = ["Error:", "FAIL", "failed", "error:"];
const TEST_RESULT_PATTERNS = ["tests passed", "tests failed", " passed", " failed", "assertion"];
const BASH_EXPLORATION_PATTERNS = ["ls", "cat ", "find ", "grep "];

const SENSITIVE_FILE_NAMES = [
  ".env",
  ".netrc",
  "credentials",
  "passwords",
  "secrets",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
  ".jks",
  ".keystore",
  ".asc",
  ".gpg",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "authorized_keys",
  "known_hosts",
];

const SENSITIVE_PATH_SEGMENTS = [".ssh/", ".aws/", ".gnupg/", ".kube/", ".docker/"];

const SENSITIVE_CONTENT_PATTERNS = [
  "BEGIN RSA PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "API_KEY=",
  "api_key=",
  "SECRET=",
  "password=",
];

const HOOK_WARNING_TAG_LIMIT_PREFIX = "[memory-mason] tag strip count exceeded";
const HOOK_WARNING_SENSITIVE_SKIP_PREFIX = "[memory-mason] skipped sensitive content";

module.exports = {
  USER_INPUT_TOOLS,
  NOISY_TOOLS,
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
};
