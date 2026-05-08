"use strict";

const CAPTURE_MODE_LITE = "lite";
const CAPTURE_MODE_FULL = "full";
const DEFAULT_CAPTURE_MODE = CAPTURE_MODE_LITE;
const DEFAULT_SUBFOLDER = "ai-knowledge";
const HOOK_EVENT_STOP = "stop";
const DUPLICATE_CAPTURE_WINDOW_MS = 60000;

const STDIN_BUFFER_BYTES = 65536;

const DEFAULT_DAILY_CHUNK_CAP_BYTES = 512000;
const MAX_DAILY_CHUNK_COUNT = 999;
const CHUNK_ID_WIDTH = 3;

const CAPTURE_HASH_ALGORITHM = "sha256";
const CAPTURE_HASH_PREFIX_LENGTH = 16;

const OBSIDIAN_CLI_TIMEOUT_MS = 8000;

const SESSION_START_RECENT_LOG_LINES = 30;
const HOT_CACHE_CONTEXT_MAX_CHARS = 5000;
const INDEX_CONTEXT_MAX_CHARS = 10000;

const PRE_COMPACT_MIN_TURNS = 5;
const UTF8_ENCODING = "utf-8";

const USER_INPUT_TOOLS = new Set(["AskUserQuestion"]);

const NOISY_TOOLS = new Set(["Read", "Glob", "LS", "List", "ls", "read", "glob"]);

/**
 * Tags removed from captured content during transcript cleanup.
 * @type {readonly string[]}
 */
const STRIP_TAGS = [
  "system-reminder",
  "system-instruction",
  "private",
  "persisted-output",
  "claude-mem-context",
  "system_instruction",
];

/**
 * Maximum number of tag-strip operations allowed per payload.
 * @type {number}
 */
const MAX_TAG_STRIP_COUNT = 100;

/**
 * Tool names treated as housekeeping or meta activity.
 * @type {ReadonlySet<string>}
 */
const META_TOOLS = new Set(["Skill", "TodoWrite", "SlashCommand", "ListMcpResourcesTool"]);

/**
 * Event type for failures and errors.
 * @type {string}
 */
const EVENT_TYPE_ERROR = "error";

/**
 * Event type for test execution results.
 * @type {string}
 */
const EVENT_TYPE_TEST_RESULT = "test_result";

/**
 * Event type for generated plans.
 * @type {string}
 */
const EVENT_TYPE_PLAN_OUTPUT = "plan_output";

/**
 * Event type for sub-agent results.
 * @type {string}
 */
const EVENT_TYPE_AGENT_RESULT = "agent_result";

/**
 * Event type for discovery content.
 * @type {string}
 */
const EVENT_TYPE_DISCOVERY = "discovery";

/**
 * Event type for decision content.
 * @type {string}
 */
const EVENT_TYPE_DECISION = "decision";

/**
 * Event type for exploration activity.
 * @type {string}
 */
const EVENT_TYPE_EXPLORATION = "exploration";

/**
 * Event type for internal/meta events.
 * @type {string}
 */
const EVENT_TYPE_META = "meta";

/**
 * Event type for ignorable noise.
 * @type {string}
 */
const EVENT_TYPE_NOISE = "noise";

/**
 * Minimum line count for content to qualify as discovery.
 * @type {number}
 */
const DISCOVERY_MIN_LINES = 20;

/**
 * Path fragment used to identify stored plan outputs.
 * @type {string}
 */
const PLAN_PATH_PATTERN = ".claude/plans/";

/**
 * Tools associated with writing plan outputs.
 * @type {ReadonlySet<string>}
 */
const PLAN_OUTPUT_TOOLS = new Set(["Write", "Edit"]);

/**
 * Tool names that indicate agent execution.
 * @type {ReadonlySet<string>}
 */
const AGENT_TOOLS = new Set(["Task", "Agent"]);

/**
 * Tool names that produce file writes.
 * @type {ReadonlySet<string>}
 */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "Create"]);

/**
 * Bash tool identifier for shell event classification.
 * @type {string}
 */
const BASH_TOOL_NAME = "bash";

/**
 * Prefixes and tokens used to classify error output.
 * @type {readonly string[]}
 */
const ERROR_PATTERNS = ["Error:", "FAIL", "failed", "error:"];

/**
 * Tokens used to classify test result output.
 * @type {readonly string[]}
 */
const TEST_RESULT_PATTERNS = ["tests passed", "tests failed", " passed", " failed", "assertion"];

/**
 * Bash command prefixes used to detect exploration activity.
 * @type {readonly string[]}
 */
const BASH_EXPLORATION_PATTERNS = ["ls", "cat ", "find ", "grep "];

/**
 * Character-to-token approximation ratio used for clipping.
 * @type {number}
 */
const TOKEN_CHARS_RATIO = 4;

/**
 * Maximum narrative token budget used during compaction.
 * @type {number}
 */
const MAX_NARRATIVE_TOKENS = 500;

/**
 * Maximum narrative character budget derived from token budget.
 * @type {number}
 */
const MAX_NARRATIVE_CHARS = MAX_NARRATIVE_TOKENS * TOKEN_CHARS_RATIO;

/**
 * Low-value filler words removed in caveman-lite compression.
 * @type {readonly string[]}
 */
const CAVEMAN_LITE_DROP_WORDS = [
  "just",
  "really",
  "basically",
  "actually",
  "simply",
  "essentially",
  "sure",
  "certainly",
];

/**
 * Low-value filler phrases removed in caveman-lite compression.
 * @type {readonly string[]}
 */
const CAVEMAN_LITE_DROP_PHRASES = [
  "of course",
  "happy to",
  "it might be worth",
  "you could consider",
  "please note",
  "in order to",
  "make sure to",
  "feel free to",
  "let me know if",
  "I'd be happy to",
  "I'll help you",
];

/**
 * Sensitive filenames and filename fragments blocked from capture.
 * @type {readonly string[]}
 */
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

/**
 * Sensitive directory path segments blocked from capture.
 * @type {readonly string[]}
 */
const SENSITIVE_PATH_SEGMENTS = [".ssh/", ".aws/", ".gnupg/", ".kube/", ".docker/"];

/**
 * Sensitive plaintext signatures blocked from capture.
 * @type {readonly string[]}
 */
const SENSITIVE_CONTENT_PATTERNS = [
  "BEGIN RSA PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "API_KEY=",
  "api_key=",
  "SECRET=",
  "password=",
];

/**
 * Prefix used for tag-limit warning messages.
 * @type {string}
 */
const HOOK_WARNING_TAG_LIMIT_PREFIX = "[memory-mason] tag strip count exceeded";

/**
 * Prefix used for sensitive-content skip warning messages.
 * @type {string}
 */
const HOOK_WARNING_SENSITIVE_SKIP_PREFIX = "[memory-mason] skipped sensitive content";

module.exports = {
  CAPTURE_MODE_LITE,
  CAPTURE_MODE_FULL,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_SUBFOLDER,
  HOOK_EVENT_STOP,
  DUPLICATE_CAPTURE_WINDOW_MS,
  STDIN_BUFFER_BYTES,
  DEFAULT_DAILY_CHUNK_CAP_BYTES,
  MAX_DAILY_CHUNK_COUNT,
  CHUNK_ID_WIDTH,
  CAPTURE_HASH_ALGORITHM,
  CAPTURE_HASH_PREFIX_LENGTH,
  OBSIDIAN_CLI_TIMEOUT_MS,
  SESSION_START_RECENT_LOG_LINES,
  HOT_CACHE_CONTEXT_MAX_CHARS,
  INDEX_CONTEXT_MAX_CHARS,
  PRE_COMPACT_MIN_TURNS,
  UTF8_ENCODING,
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
  TOKEN_CHARS_RATIO,
  MAX_NARRATIVE_TOKENS,
  MAX_NARRATIVE_CHARS,
  CAVEMAN_LITE_DROP_WORDS,
  CAVEMAN_LITE_DROP_PHRASES,
  SENSITIVE_FILE_NAMES,
  SENSITIVE_PATH_SEGMENTS,
  SENSITIVE_CONTENT_PATTERNS,
  HOOK_WARNING_TAG_LIMIT_PREFIX,
  HOOK_WARNING_SENSITIVE_SKIP_PREFIX,
};
