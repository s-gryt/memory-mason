"use strict";

const path = require("node:path");
const {
  buildAdditionalContext,
  truncateContext,
  buildDailyEntry,
  buildAssistantReplyEntry,
  buildSessionHeader,
  buildDailyHeader,
  takeLastLines,
  buildDailyFilePath,
  buildKnowledgeIndexPath,
  buildDailyFolderPath,
  buildDailyChunkPath,
  buildDailyIndexPath,
  buildDailyMetaPath,
  buildChunkHeader,
  buildChunkIndexContent,
} = require("../lib/vault");

describe("truncateContext", () => {
  it("returns original text when under limit", () => {
    expect(truncateContext("hello", 10)).toBe("hello");
  });

  it("returns original text when exactly at limit", () => {
    expect(truncateContext("hello", 5)).toBe("hello");
  });

  it("truncates and appends marker when over limit", () => {
    const marker = "\n\n...(truncated)";
    const maxChars = 5;
    const result = truncateContext("abcdefghij", maxChars);

    expect(result.endsWith(marker)).toBe(true);
    expect(result).toBe(`abcde${marker}`);
    expect(result.length).toBe(maxChars + marker.length);
  });

  it("throws on non-string text", () => {
    expect(() => truncateContext(123, 5)).toThrow("text must be a string");
  });

  it("throws on non-positive maxChars", () => {
    expect(() => truncateContext("hello", 0)).toThrow("maxChars must be a positive integer");
  });
});

describe("buildDailyEntry", () => {
  it("formats tool name and result with HH:MM:SS timestamp", () => {
    expect(buildDailyEntry("Write", "some result", "14:30:00")).toBe(
      "\n**[14:30:00] Write**\nsome result\n",
    );
  });

  it("preserves full resultText without truncation", () => {
    const resultText = "a".repeat(600);
    const entry = buildDailyEntry("Write", resultText, "14:30:00");
    const lines = entry.split("\n");

    expect(lines[2].length).toBe(600);
    expect(lines[2]).toBe(resultText);
  });

  it("handles empty resultText", () => {
    expect(buildDailyEntry("Write", "", "14:30:00")).toBe("\n**[14:30:00] Write**\n\n");
  });

  it("throws on empty toolName", () => {
    expect(() => buildDailyEntry("", "some result", "14:30:00")).toThrow(
      "toolName must be a non-empty string",
    );
  });

  it("throws on empty timestamp", () => {
    expect(() => buildDailyEntry("Write", "some result", "")).toThrow(
      "timestamp must be a non-empty string",
    );
  });

  it("throws when timestamp is not HH:MM:SS format", () => {
    expect(() => buildDailyEntry("Write", "some result", "2026-04-26T14:30:00.000Z")).toThrow(
      "timestamp must be in HH:MM:SS format",
    );
    expect(() => buildDailyEntry("Write", "some result", "14:30")).toThrow(
      "timestamp must be in HH:MM:SS format",
    );
  });
});

describe("buildAssistantReplyEntry", () => {
  it("preserves full assistant content without truncation", () => {
    const content = "x".repeat(6000);
    const entry = buildAssistantReplyEntry(content, "09:00:00");

    expect(entry).toBe(`\n**[09:00:00] AssistantReply**\n${content}\n`);
    expect(entry.includes("...(truncated)")).toBe(false);
  });

  it("throws when timestamp is not HH:MM:SS format", () => {
    expect(() => buildAssistantReplyEntry("reply", "bad")).toThrow(
      "timestamp must be in HH:MM:SS format",
    );
  });

  it("throws on non-string content", () => {
    expect(() => buildAssistantReplyEntry(123, "09:00:00")).toThrow("content must be a string");
  });
});

describe("buildSessionHeader", () => {
  it("formats sessionId and source into header", () => {
    expect(buildSessionHeader("abc123", "new", "2026-04-26T14:30:00.000Z")).toBe(
      "\n## Session [2026-04-26T14:30:00.000Z] abc123 / new\n\n",
    );
  });

  it("uses unknown for empty sessionId", () => {
    expect(buildSessionHeader("", "new", "2026-04-26T14:30:00.000Z")).toBe(
      "\n## Session [2026-04-26T14:30:00.000Z] unknown / new\n\n",
    );
  });

  it("uses unknown for empty source", () => {
    expect(buildSessionHeader("abc123", "", "2026-04-26T14:30:00.000Z")).toBe(
      "\n## Session [2026-04-26T14:30:00.000Z] abc123 / unknown\n\n",
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

    expect(result.includes("(empty - no articles compiled yet)")).toBe(true);
  });

  it("includes recentLogText when provided", () => {
    const recentLogText = "latest entry";
    const result = buildAdditionalContext("index", recentLogText);

    expect(result.includes(recentLogText)).toBe(true);
  });

  it("uses placeholder when recentLogText is empty", () => {
    const result = buildAdditionalContext("index", "");

    expect(result.includes("(no recent daily log)")).toBe(true);
  });

  it("includes Today, Knowledge Base Index, and Recent Daily Log sections", () => {
    const result = buildAdditionalContext("index", "log");

    expect(result.includes("## Today")).toBe(true);
    expect(result.includes("## Knowledge Base Index")).toBe(true);
    expect(result.includes("## Recent Daily Log")).toBe(true);
  });

  it("uses custom primary section heading and placeholder when provided", () => {
    const result = buildAdditionalContext("", "log", "Hot Cache", "(empty - no hot cache yet)");

    expect(result.includes("## Hot Cache")).toBe(true);
    expect(result.includes("(empty - no hot cache yet)")).toBe(true);
    expect(result.includes("## Knowledge Base Index")).toBe(false);
  });

  it("throws on non-string indexText", () => {
    expect(() => buildAdditionalContext(123, "log")).toThrow("indexText must be a string");
  });

  it("throws on non-string recentLogText", () => {
    expect(() => buildAdditionalContext("index", null)).toThrow("recentLogText must be a string");
  });
});

describe("buildDailyHeader", () => {
  it("returns correct header format for a date", () => {
    expect(buildDailyHeader("2026-04-26")).toBe("# Daily Log: 2026-04-26\n\n## Sessions\n\n");
  });

  it("throws on empty dateIso", () => {
    expect(() => buildDailyHeader("")).toThrow("dateIso must be a non-empty string");
  });
});

describe("takeLastLines", () => {
  it("returns last N lines", () => {
    expect(takeLastLines("a\nb\nc\nd", 2)).toBe("c\nd");
  });

  it("returns all lines when fewer than maxLines", () => {
    expect(takeLastLines("a\nb", 5)).toBe("a\nb");
  });

  it("returns empty string for empty text", () => {
    expect(takeLastLines("", 3)).toBe("");
  });

  it("throws on non-string text", () => {
    expect(() => takeLastLines(undefined, 2)).toThrow("text must be a string");
  });

  it("throws on non-positive maxLines", () => {
    expect(() => takeLastLines("a\nb", 0)).toThrow("maxLines must be a positive integer");
  });
});

describe("buildDailyFilePath", () => {
  it("builds correct path", () => {
    expect(buildDailyFilePath("/vault", "ai-knowledge", "2026-04-26")).toBe(
      path.join("/vault", "ai-knowledge", "daily", "2026-04-26.md"),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyFilePath("", "ai-knowledge", "2026-04-26")).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildKnowledgeIndexPath", () => {
  it("builds correct path", () => {
    expect(buildKnowledgeIndexPath("/vault", "ai-knowledge")).toBe(
      path.join("/vault", "ai-knowledge", "knowledge", "index.md"),
    );
  });

  it("throws on empty subfolder", () => {
    expect(() => buildKnowledgeIndexPath("/vault", "")).toThrow(
      "subfolder must be a non-empty string",
    );
  });
});

describe("buildDailyFolderPath", () => {
  it("returns correct path", () => {
    expect(buildDailyFolderPath("/vault", "ai-knowledge", "2026-04-30")).toBe(
      path.join("/vault", "ai-knowledge", "daily", "2026-04-30"),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyFolderPath("", "ai-knowledge", "2026-04-30")).toThrow(
      "vaultPath must be a non-empty string",
    );
  });

  it("throws on empty subfolder", () => {
    expect(() => buildDailyFolderPath("/vault", "", "2026-04-30")).toThrow(
      "subfolder must be a non-empty string",
    );
  });

  it("throws on empty dateIso", () => {
    expect(() => buildDailyFolderPath("/vault", "ai-knowledge", "")).toThrow(
      "dateIso must be a non-empty string",
    );
  });
});

describe("buildDailyChunkPath", () => {
  it("pads chunk 1 as 001.md", () => {
    expect(buildDailyChunkPath("/vault", "ai-knowledge", "2026-04-30", 1)).toBe(
      path.join("/vault", "ai-knowledge", "daily", "2026-04-30", "001.md"),
    );
  });

  it("pads chunk 12 as 012.md", () => {
    expect(buildDailyChunkPath("/vault", "ai-knowledge", "2026-04-30", 12)).toBe(
      path.join("/vault", "ai-knowledge", "daily", "2026-04-30", "012.md"),
    );
  });

  it("throws on chunkNum 0", () => {
    expect(() => buildDailyChunkPath("/vault", "ai-knowledge", "2026-04-30", 0)).toThrow(
      "chunkNum must be a positive integer",
    );
  });

  it("throws on non-integer chunkNum", () => {
    expect(() => buildDailyChunkPath("/vault", "ai-knowledge", "2026-04-30", 1.5)).toThrow(
      "chunkNum must be a positive integer",
    );
  });

  it("throws on chunkNum 1000", () => {
    expect(() => buildDailyChunkPath("/vault", "ai-knowledge", "2026-04-30", 1000)).toThrow(
      "chunkNum must be less than or equal to 999",
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyChunkPath("", "ai-knowledge", "2026-04-30", 1)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildDailyIndexPath", () => {
  it("returns correct index.md path", () => {
    expect(buildDailyIndexPath("/vault", "ai-knowledge", "2026-04-30")).toBe(
      path.join("/vault", "ai-knowledge", "daily", "2026-04-30", "index.md"),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyIndexPath("", "ai-knowledge", "2026-04-30")).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildDailyMetaPath", () => {
  it("returns correct meta.json path", () => {
    expect(buildDailyMetaPath("/vault", "ai-knowledge", "2026-04-30")).toBe(
      path.join("/vault", "ai-knowledge", "daily", "2026-04-30", "meta.json"),
    );
  });

  it("throws on empty vaultPath", () => {
    expect(() => buildDailyMetaPath("", "ai-knowledge", "2026-04-30")).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("buildChunkHeader", () => {
  it("includes dateIso", () => {
    expect(buildChunkHeader("2026-04-30", 1).includes("2026-04-30")).toBe(true);
  });

  it("includes part number", () => {
    expect(buildChunkHeader("2026-04-30", 7).includes("(Part 7)")).toBe(true);
  });

  it("throws on empty dateIso", () => {
    expect(() => buildChunkHeader("", 1)).toThrow("dateIso must be a non-empty string");
  });

  it("throws on chunkNum 0", () => {
    expect(() => buildChunkHeader("2026-04-30", 0)).toThrow("chunkNum must be a positive integer");
  });

  it("throws on chunkNum 1000", () => {
    expect(() => buildChunkHeader("2026-04-30", 1000)).toThrow(
      "chunkNum must be less than or equal to 999",
    );
  });
});

describe("buildChunkIndexContent", () => {
  it("single chunk produces one wikilink", () => {
    expect(buildChunkIndexContent("2026-04-30", 1)).toBe(
      "# Daily Log: 2026-04-30\n\n## Parts\n\n- [[daily/2026-04-30/001|Part 1]]\n",
    );
  });

  it("three chunks produces three wikilinks", () => {
    expect(buildChunkIndexContent("2026-04-30", 3)).toBe(
      "# Daily Log: 2026-04-30\n\n## Parts\n\n- [[daily/2026-04-30/001|Part 1]]\n- [[daily/2026-04-30/002|Part 2]]\n- [[daily/2026-04-30/003|Part 3]]\n",
    );
  });

  it("wikilinks use correct Obsidian format", () => {
    const result = buildChunkIndexContent("2026-04-30", 2);

    expect(result.includes("- [[daily/2026-04-30/001|Part 1]]")).toBe(true);
    expect(result.includes("- [[daily/2026-04-30/002|Part 2]]")).toBe(true);
  });

  it("throws on chunkCount 0", () => {
    expect(() => buildChunkIndexContent("2026-04-30", 0)).toThrow(
      "chunkCount must be a positive integer",
    );
  });

  it("throws on chunkCount 1000", () => {
    expect(() => buildChunkIndexContent("2026-04-30", 1000)).toThrow(
      "chunkCount must be less than or equal to 999",
    );
  });

  it("throws on empty dateIso", () => {
    expect(() => buildChunkIndexContent("", 1)).toThrow("dateIso must be a non-empty string");
  });
});
