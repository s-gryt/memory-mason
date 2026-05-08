"use strict";

const path = require("node:path");
const { CHUNK_ID_WIDTH, MAX_DAILY_CHUNK_COUNT } = require("../../lib/vault/constants");
const {
  DAILY_META_FILE_NAME,
  ROOT_INDEX_FILE_NAME,
  SESSION_CONTEXT_FILE_NAME,
  VAULT_META_DIR_NAME,
  VAULT_RAW_DIR_NAME,
} = require("../../lib/vault/vault-paths");
const {
  TEST_DEFAULT_DATE,
  TEST_DEFAULT_VAULT_PATH,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_ASSISTANT_REPLY_ENTRY_NAME: ASSISTANT_REPLY_ENTRY_NAME,
  TEST_DAILY_LOG_HEADING_PREFIX: DAILY_LOG_HEADING_PREFIX,
  TEST_KNOWLEDGE_BASE_INDEX_HEADING: KNOWLEDGE_BASE_INDEX_HEADING,
  TEST_PARTS_HEADING: PARTS_HEADING,
  TEST_PLACEHOLDER_NO_ARTICLES: PLACEHOLDER_NO_ARTICLES,
  TEST_PLACEHOLDER_NO_RECENT_DAILY_LOG: PLACEHOLDER_NO_RECENT_DAILY_LOG,
  TEST_PLACEHOLDER_NO_SESSION_CONTEXT: PLACEHOLDER_NO_SESSION_CONTEXT,
  TEST_RECENT_DAILY_LOG_HEADING: RECENT_DAILY_LOG_HEADING,
  TEST_SESSION_CONTEXT_HEADING: SESSION_CONTEXT_HEADING,
  TEST_SESSIONS_HEADING: SESSIONS_HEADING,
  TEST_TODAY_HEADING: TODAY_HEADING,
  TEST_TRUNCATION_MARKER: TRUNCATION_MARKER,
  TEST_UNKNOWN_LABEL: UNKNOWN_LABEL,
} = require("../helpers/test-constants");
const {
  buildAdditionalContext,
  truncateContext,
  buildDailyEntry,
  buildAssistantReplyEntry,
  buildSessionHeader,
  buildDailyHeader,
  takeLastLines,
  buildDailyFilePath,
  buildRootIndexPath,
  buildSessionContextPath,
  buildKnowledgeIndexPath,
  buildHotCachePath,
  buildDailyFolderPath,
  buildDailyChunkPath,
  buildDailyIndexPath,
  buildDailyMetaPath,
  buildChunkHeader,
  buildChunkIndexContent,
} = require("../../lib/vault/vault");

const TEST_NON_STRING_VALUE = 123;
const TEST_UNDER_LIMIT_MAX_CHARS = 10;
const TEST_TRUNCATE_LIMIT = 5;
const TEST_RESULT_TEXT_LENGTH = 600;
const TEST_ASSISTANT_CONTENT_LENGTH = 6000;
const TEST_SECOND_LINE_INDEX = 2;
const TEST_LAST_LINES_TWO = 2;
const TEST_LAST_LINES_THREE = 3;
const TEST_LAST_LINES_FIVE = 5;
const TEST_CHUNK_NUM_SEVEN = 7;
const TEST_CHUNK_NUM_TWELVE = 12;
const TEST_CHUNK_COUNT_TWO = 2;
const TEST_CHUNK_COUNT_THREE = 3;
const TEST_INVALID_CHUNK_NUM_DECIMAL = 1.5;
const TEST_CHUNK_OVERFLOW = MAX_DAILY_CHUNK_COUNT + 1;

const TOOL_WRITE = "Write";
const TOOL_RESULT = "some result";
const TIMESTAMP_AFTERNOON = "14:30:00";
const TIMESTAMP_MORNING = "09:00:00";
const TEST_DATE_2026_04_26 = "2026-04-26";
const TEST_DATE_2026_04_26_ISO = "2026-04-26T14:30:00.000Z";

describe("truncateContext", () => {
  it("returns original text when under limit", () => {
    expect(truncateContext("hello", TEST_UNDER_LIMIT_MAX_CHARS)).toBe("hello");
  });

  it("returns original text when exactly at limit", () => {
    expect(truncateContext("hello", TEST_TRUNCATE_LIMIT)).toBe("hello");
  });

  it("truncates and appends marker when over limit", () => {
    const marker = `\n\n${TRUNCATION_MARKER}`;
    const maxChars = TEST_TRUNCATE_LIMIT;
    const result = truncateContext("abcdefghij", maxChars);

    expect(result.endsWith(marker)).toBe(true);
    expect(result).toBe(`abcde${marker}`);
    expect(result.length).toBe(maxChars + marker.length);
  });

  it("throws on non-string text", () => {
    expect(() => truncateContext(TEST_NON_STRING_VALUE, TEST_TRUNCATE_LIMIT)).toThrow(
      "text must be a string",
    );
  });

  it("throws on non-positive maxChars", () => {
    expect(() => truncateContext("hello", 0)).toThrow("maxChars must be a positive integer");
  });
});

describe("buildDailyEntry", () => {
  it("formats tool name and result with HH:MM:SS timestamp", () => {
    expect(buildDailyEntry(TOOL_WRITE, TOOL_RESULT, TIMESTAMP_AFTERNOON)).toBe(
      `\n**[${TIMESTAMP_AFTERNOON}] ${TOOL_WRITE}**\n${TOOL_RESULT}\n`,
    );
  });

  it("preserves full resultText without truncation", () => {
    const resultText = "a".repeat(TEST_RESULT_TEXT_LENGTH);
    const entry = buildDailyEntry(TOOL_WRITE, resultText, TIMESTAMP_AFTERNOON);
    const lines = entry.split("\n");

    expect(lines[TEST_SECOND_LINE_INDEX].length).toBe(TEST_RESULT_TEXT_LENGTH);
    expect(lines[TEST_SECOND_LINE_INDEX]).toBe(resultText);
  });

  it("handles empty resultText", () => {
    expect(buildDailyEntry(TOOL_WRITE, "", TIMESTAMP_AFTERNOON)).toBe(
      `\n**[${TIMESTAMP_AFTERNOON}] ${TOOL_WRITE}**\n\n`,
    );
  });

  it("throws on empty toolName", () => {
    expect(() => buildDailyEntry("", TOOL_RESULT, TIMESTAMP_AFTERNOON)).toThrow(
      "toolName must be a non-empty string",
    );
  });

  it("throws on empty timestamp", () => {
    expect(() => buildDailyEntry(TOOL_WRITE, TOOL_RESULT, "")).toThrow(
      "timestamp must be a non-empty string",
    );
  });

  it("throws when timestamp is not HH:MM:SS format", () => {
    expect(() => buildDailyEntry(TOOL_WRITE, TOOL_RESULT, TEST_DATE_2026_04_26_ISO)).toThrow(
      "timestamp must be in HH:MM:SS format",
    );
    expect(() => buildDailyEntry(TOOL_WRITE, TOOL_RESULT, "14:30")).toThrow(
      "timestamp must be in HH:MM:SS format",
    );
  });
});

describe("buildAssistantReplyEntry", () => {
  it("preserves full assistant content without truncation", () => {
    const content = "x".repeat(TEST_ASSISTANT_CONTENT_LENGTH);
    const entry = buildAssistantReplyEntry(content, TIMESTAMP_MORNING);

    expect(entry).toBe(`\n**[${TIMESTAMP_MORNING}] ${ASSISTANT_REPLY_ENTRY_NAME}**\n${content}\n`);
    expect(entry.includes(TRUNCATION_MARKER)).toBe(false);
  });

  it("throws when timestamp is not HH:MM:SS format", () => {
    expect(() => buildAssistantReplyEntry("reply", "bad")).toThrow(
      "timestamp must be in HH:MM:SS format",
    );
  });

  it("throws on non-string content", () => {
    expect(() => buildAssistantReplyEntry(TEST_NON_STRING_VALUE, TIMESTAMP_MORNING)).toThrow(
      "content must be a string",
    );
  });
});

describe("buildSessionHeader", () => {
  it("formats sessionId and source into header", () => {
    expect(buildSessionHeader("abc123", "new", TEST_DATE_2026_04_26_ISO)).toBe(
      `\n## Session [${TEST_DATE_2026_04_26_ISO}] abc123 / new\n\n`,
    );
  });

  it("uses unknown for empty sessionId", () => {
    expect(buildSessionHeader("", "new", TEST_DATE_2026_04_26_ISO)).toBe(
      `\n## Session [${TEST_DATE_2026_04_26_ISO}] ${UNKNOWN_LABEL} / new\n\n`,
    );
  });

  it("uses unknown for empty source", () => {
    expect(buildSessionHeader("abc123", "", TEST_DATE_2026_04_26_ISO)).toBe(
      `\n## Session [${TEST_DATE_2026_04_26_ISO}] abc123 / ${UNKNOWN_LABEL}\n\n`,
    );
  });

  it("throws on empty timestamp", () => {
    expect(() => buildSessionHeader("abc123", "new", "")).toThrow(
      "timestamp must be a non-empty string",
    );
  });
});

describe("buildAdditionalContext", () => {
  it("includes index content when provided", () => {
    const indexText = "- Concept A";
    const result = buildAdditionalContext(indexText, "recent log");

    expect(result.includes(indexText)).toBe(true);
  });

  it("uses placeholder when indexText is empty", () => {
    const result = buildAdditionalContext("", "recent log");

    expect(result.includes(PLACEHOLDER_NO_ARTICLES)).toBe(true);
  });

  it("includes recentLogText when provided", () => {
    const recentLogText = "latest entry";
    const result = buildAdditionalContext("index", recentLogText);

    expect(result.includes(recentLogText)).toBe(true);
  });

  it("uses placeholder when recentLogText is empty", () => {
    const result = buildAdditionalContext("index", "");

    expect(result.includes(PLACEHOLDER_NO_RECENT_DAILY_LOG)).toBe(true);
  });

  it("includes Today, Knowledge Base Index, and Recent Daily Log sections", () => {
    const result = buildAdditionalContext("index", "log");

    expect(result.includes(`## ${TODAY_HEADING}`)).toBe(true);
    expect(result.includes(`## ${KNOWLEDGE_BASE_INDEX_HEADING}`)).toBe(true);
    expect(result.includes(`## ${RECENT_DAILY_LOG_HEADING}`)).toBe(true);
  });

  it("uses custom primary section heading and placeholder when provided", () => {
    const result = buildAdditionalContext(
      "",
      "log",
      SESSION_CONTEXT_HEADING,
      PLACEHOLDER_NO_SESSION_CONTEXT,
    );

    expect(result.includes(`## ${SESSION_CONTEXT_HEADING}`)).toBe(true);
    expect(result.includes(PLACEHOLDER_NO_SESSION_CONTEXT)).toBe(true);
    expect(result.includes(`## ${KNOWLEDGE_BASE_INDEX_HEADING}`)).toBe(false);
  });

  it("throws on non-string indexText", () => {
    expect(() => buildAdditionalContext(TEST_NON_STRING_VALUE, "log")).toThrow(
      "indexText must be a string",
    );
  });

  it("throws on non-string recentLogText", () => {
    expect(() => buildAdditionalContext("index", null)).toThrow("recentLogText must be a string");
  });
});

describe("buildDailyHeader", () => {
  it("returns correct header format for a date", () => {
    expect(buildDailyHeader(TEST_DATE_2026_04_26)).toBe(
      `# ${DAILY_LOG_HEADING_PREFIX}${TEST_DATE_2026_04_26}\n\n## ${SESSIONS_HEADING}\n\n`,
    );
  });

  it("throws on empty dateIso", () => {
    expect(() => buildDailyHeader("")).toThrow("dateIso must be a non-empty string");
  });
});

describe("takeLastLines", () => {
  it("returns last N lines", () => {
    expect(takeLastLines("a\nb\nc\nd", TEST_LAST_LINES_TWO)).toBe("c\nd");
  });

  it("returns all lines when fewer than maxLines", () => {
    expect(takeLastLines("a\nb", TEST_LAST_LINES_FIVE)).toBe("a\nb");
  });

  it("returns empty string for empty text", () => {
    expect(takeLastLines("", TEST_LAST_LINES_THREE)).toBe("");
  });

  it("throws on non-string text", () => {
    expect(() => takeLastLines(undefined, TEST_LAST_LINES_TWO)).toThrow("text must be a string");
  });

  it("throws on non-positive maxLines", () => {
    expect(() => takeLastLines("a\nb", 0)).toThrow("maxLines must be a positive integer");
  });
});

describe("buildDailyFilePath", () => {
  it("builds correct path", () => {
    expect(
      buildDailyFilePath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, TEST_DATE_2026_04_26),
    ).toBe(
      path.join(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        VAULT_RAW_DIR_NAME,
        `${TEST_DATE_2026_04_26}.md`,
      ),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyFilePath("", DEFAULT_SUBFOLDER, TEST_DATE_2026_04_26)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildRootIndexPath", () => {
  it("builds correct path", () => {
    expect(buildRootIndexPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER)).toBe(
      path.join(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, ROOT_INDEX_FILE_NAME),
    );
  });

  it("throws on empty subfolder", () => {
    expect(() => buildRootIndexPath(TEST_DEFAULT_VAULT_PATH, "")).toThrow(
      "subfolder must be a non-empty string",
    );
  });
});

describe("buildSessionContextPath", () => {
  it("builds correct path", () => {
    expect(buildSessionContextPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER)).toBe(
      path.join(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        VAULT_META_DIR_NAME,
        SESSION_CONTEXT_FILE_NAME,
      ),
    );
  });

  it("throws on empty subfolder", () => {
    expect(() => buildSessionContextPath(TEST_DEFAULT_VAULT_PATH, "")).toThrow(
      "subfolder must be a non-empty string",
    );
  });
});

describe("backward-compatible path aliases", () => {
  it("keeps buildKnowledgeIndexPath as alias of buildRootIndexPath", () => {
    expect(buildKnowledgeIndexPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER)).toBe(
      buildRootIndexPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER),
    );
  });

  it("keeps buildHotCachePath as alias of buildSessionContextPath", () => {
    expect(buildHotCachePath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER)).toBe(
      buildSessionContextPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER),
    );
  });
});

describe("buildDailyFolderPath", () => {
  it("returns correct path", () => {
    expect(
      buildDailyFolderPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE),
    ).toBe(
      path.join(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, VAULT_RAW_DIR_NAME, TEST_DEFAULT_DATE),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyFolderPath("", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });

  it("throws on empty subfolder", () => {
    expect(() => buildDailyFolderPath(TEST_DEFAULT_VAULT_PATH, "", TEST_DEFAULT_DATE)).toThrow(
      "subfolder must be a non-empty string",
    );
  });

  it("throws on empty dateIso", () => {
    expect(() => buildDailyFolderPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, "")).toThrow(
      "dateIso must be a non-empty string",
    );
  });
});

describe("buildDailyChunkPath", () => {
  it("pads chunk 1 as 001.md", () => {
    expect(
      buildDailyChunkPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, 1),
    ).toBe(
      path.join(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        VAULT_RAW_DIR_NAME,
        TEST_DEFAULT_DATE,
        "001.md",
      ),
    );
  });

  it("pads chunk 12 as 012.md", () => {
    expect(
      buildDailyChunkPath(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        TEST_DEFAULT_DATE,
        TEST_CHUNK_NUM_TWELVE,
      ),
    ).toBe(
      path.join(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        VAULT_RAW_DIR_NAME,
        TEST_DEFAULT_DATE,
        "012.md",
      ),
    );
  });

  it("throws on chunkNum 0", () => {
    expect(() =>
      buildDailyChunkPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, 0),
    ).toThrow("chunkNum must be a positive integer");
  });

  it("throws on non-integer chunkNum", () => {
    expect(() =>
      buildDailyChunkPath(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        TEST_DEFAULT_DATE,
        TEST_INVALID_CHUNK_NUM_DECIMAL,
      ),
    ).toThrow("chunkNum must be a positive integer");
  });

  it("throws on chunkNum 1000", () => {
    expect(() =>
      buildDailyChunkPath(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        TEST_DEFAULT_DATE,
        TEST_CHUNK_OVERFLOW,
      ),
    ).toThrow("chunkNum must be less than or equal to 999");
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyChunkPath("", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE, 1)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildDailyIndexPath", () => {
  it("returns correct index.md path", () => {
    expect(buildDailyIndexPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE)).toBe(
      path.join(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        VAULT_RAW_DIR_NAME,
        TEST_DEFAULT_DATE,
        ROOT_INDEX_FILE_NAME,
      ),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyIndexPath("", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildDailyMetaPath", () => {
  it("returns correct meta.json path", () => {
    expect(buildDailyMetaPath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE)).toBe(
      path.join(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        VAULT_RAW_DIR_NAME,
        TEST_DEFAULT_DATE,
        DAILY_META_FILE_NAME,
      ),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyMetaPath("", DEFAULT_SUBFOLDER, TEST_DEFAULT_DATE)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildChunkHeader", () => {
  it("includes dateIso", () => {
    expect(buildChunkHeader(TEST_DEFAULT_DATE, 1).includes(TEST_DEFAULT_DATE)).toBe(true);
  });

  it("includes part number", () => {
    expect(buildChunkHeader(TEST_DEFAULT_DATE, TEST_CHUNK_NUM_SEVEN).includes("(Part 7)")).toBe(
      true,
    );
  });

  it("throws on empty dateIso", () => {
    expect(() => buildChunkHeader("", 1)).toThrow("dateIso must be a non-empty string");
  });

  it("throws on chunkNum 0", () => {
    expect(() => buildChunkHeader(TEST_DEFAULT_DATE, 0)).toThrow(
      "chunkNum must be a positive integer",
    );
  });

  it("throws on chunkNum 1000", () => {
    expect(() => buildChunkHeader(TEST_DEFAULT_DATE, TEST_CHUNK_OVERFLOW)).toThrow(
      "chunkNum must be less than or equal to 999",
    );
  });
});

describe("buildChunkIndexContent", () => {
  it("single chunk produces one wikilink", () => {
    expect(buildChunkIndexContent(TEST_DEFAULT_DATE, 1)).toBe(
      `# ${DAILY_LOG_HEADING_PREFIX}${TEST_DEFAULT_DATE}\n\n## ${PARTS_HEADING}\n\n- [[${VAULT_RAW_DIR_NAME}/${TEST_DEFAULT_DATE}/${String(1).padStart(CHUNK_ID_WIDTH, "0")}|Part 1]]\n`,
    );
  });

  it("three chunks produces three wikilinks", () => {
    expect(buildChunkIndexContent(TEST_DEFAULT_DATE, TEST_CHUNK_COUNT_THREE)).toBe(
      `# ${DAILY_LOG_HEADING_PREFIX}${TEST_DEFAULT_DATE}\n\n## ${PARTS_HEADING}\n\n- [[${VAULT_RAW_DIR_NAME}/${TEST_DEFAULT_DATE}/001|Part 1]]\n- [[${VAULT_RAW_DIR_NAME}/${TEST_DEFAULT_DATE}/002|Part 2]]\n- [[${VAULT_RAW_DIR_NAME}/${TEST_DEFAULT_DATE}/003|Part 3]]\n`,
    );
  });

  it("wikilinks use correct Obsidian format", () => {
    const result = buildChunkIndexContent(TEST_DEFAULT_DATE, TEST_CHUNK_COUNT_TWO);

    expect(result.includes(`- [[${VAULT_RAW_DIR_NAME}/${TEST_DEFAULT_DATE}/001|Part 1]]`)).toBe(
      true,
    );
    expect(result.includes(`- [[${VAULT_RAW_DIR_NAME}/${TEST_DEFAULT_DATE}/002|Part 2]]`)).toBe(
      true,
    );
  });

  it("throws on chunkCount 0", () => {
    expect(() => buildChunkIndexContent(TEST_DEFAULT_DATE, 0)).toThrow(
      "chunkCount must be a positive integer",
    );
  });

  it("throws on chunkCount 1000", () => {
    expect(() => buildChunkIndexContent(TEST_DEFAULT_DATE, TEST_CHUNK_OVERFLOW)).toThrow(
      "chunkCount must be less than or equal to 999",
    );
  });

  it("throws on empty dateIso", () => {
    expect(() => buildChunkIndexContent("", 1)).toThrow("dateIso must be a non-empty string");
  });
});
