"use strict";

const {
  extractTagText,
  stripAnsiEscapeSequences,
  normalizeTranscriptText,
  parseJsonlTranscript,
  filterMmTurns,
  selectRecentTurns,
  renderTurnsAsMarkdown,
  buildFullTranscript,
  buildTranscriptExcerpt,
} = require("../lib/transcript");

describe("transcript normalization helpers", () => {
  it("extracts text from a tagged block", () => {
    expect(extractTagText("<command-name>/model</command-name>", "command-name")).toBe("/model");
  });

  it("returns empty string when tag is absent", () => {
    expect(extractTagText("plain text", "command-name")).toBe("");
  });

  it("returns empty string for invalid tagged-content inputs", () => {
    expect(extractTagText(null, "command-name")).toBe("");
    expect(extractTagText("<command-name>/model</command-name>", "")).toBe("");
  });

  it("strips ANSI escape sequences", () => {
    expect(stripAnsiEscapeSequences("Set model to \u001b[1mOpus\u001b[22m")).toBe(
      "Set model to Opus",
    );
  });

  it("returns empty string when stripping ANSI from non-string input", () => {
    expect(stripAnsiEscapeSequences(null)).toBe("");
  });

  it("normalizes slash-command transcript metadata into readable prompt text", () => {
    const content = [
      "<command-message>caveman:caveman</command-message>",
      "<command-name>/caveman:caveman</command-name>",
      "<command-args>ask a backed question</command-args>",
    ].join("\n");

    expect(normalizeTranscriptText(content)).toBe("/caveman:caveman ask a backed question");
  });

  it("normalizes local command stdout into readable text", () => {
    const content =
      "<local-command-stdout>Set model to \u001b[1mOpus\u001b[22m</local-command-stdout>";

    expect(normalizeTranscriptText(content)).toBe("Set model to Opus");
  });

  it("returns empty string when normalizing non-string transcript content", () => {
    expect(normalizeTranscriptText(null)).toBe("");
  });
});

describe("parseJsonlTranscript", () => {
  it("parses Claude-style JSONL with message.role and string content", () => {
    const input = [
      JSON.stringify({ message: { role: "user", content: "hello" } }),
      JSON.stringify({ message: { role: "assistant", content: "world" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("parses block-array content and concatenates text blocks", () => {
    const input = JSON.stringify({
      message: {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([{ role: "user", content: "hello\nworld" }]);
  });

  it("skips non-text blocks in block array", () => {
    const input = JSON.stringify({
      message: {
        role: "user",
        content: [
          { type: "tool_use", name: "something" },
          { type: "text", text: "first" },
          { type: "tool_result", result: "ignored" },
          { type: "text", text: "second" },
        ],
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([{ role: "user", content: "first\nsecond" }]);
  });

  it("parses flat format with top-level role and content", () => {
    const input = JSON.stringify({ role: "user", content: "test" });

    expect(parseJsonlTranscript(input)).toEqual([{ role: "user", content: "test" }]);
  });

  it("parses VS Code transcript entries with type and data content", () => {
    const input = [
      JSON.stringify({
        id: "entry-0",
        timestamp: "2025-01-01T00:00:00.000Z",
        parentId: null,
        type: "session.start",
        data: { sessionId: "session-1" },
      }),
      JSON.stringify({
        id: "entry-1",
        timestamp: "2025-01-01T00:00:01.000Z",
        parentId: "entry-0",
        type: "user.message",
        data: { content: "hello", attachments: [] },
      }),
      JSON.stringify({
        id: "entry-2",
        timestamp: "2025-01-01T00:00:02.000Z",
        parentId: "entry-1",
        type: "assistant.turn_start",
        data: { turnId: "0.0" },
      }),
      JSON.stringify({
        id: "entry-3",
        timestamp: "2025-01-01T00:00:03.000Z",
        parentId: "entry-2",
        type: "assistant.message",
        data: { messageId: "message-1", content: "world", toolRequests: [] },
      }),
      JSON.stringify({
        id: "entry-4",
        timestamp: "2025-01-01T00:00:04.000Z",
        parentId: "entry-3",
        type: "assistant.turn_end",
        data: { turnId: "0.0" },
      }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("ignores VS Code transcript message entries with malformed data payloads", () => {
    const input = JSON.stringify({
      id: "entry-1",
      timestamp: "2025-01-01T00:00:01.000Z",
      parentId: null,
      type: "assistant.message",
      data: "invalid",
    });

    expect(parseJsonlTranscript(input)).toEqual([]);
  });

  it("ignores blank lines", () => {
    const input = [
      "",
      JSON.stringify({ message: { role: "user", content: "hello" } }),
      "",
      JSON.stringify({ message: { role: "assistant", content: "world" } }),
      "",
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("ignores malformed JSON lines", () => {
    const input = [
      JSON.stringify({ message: { role: "user", content: "hello" } }),
      "{not-json",
      JSON.stringify({ message: { role: "assistant", content: "world" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("ignores system and tool roles", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "tool", content: "call" } }),
      JSON.stringify({ message: { role: "user", content: "question" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([{ role: "user", content: "question" }]);
  });

  it("ignores parsed JSON values that are not objects", () => {
    const input = [
      "123",
      JSON.stringify({ message: { role: "assistant", content: "world" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([{ role: "assistant", content: "world" }]);
  });

  it("ignores entries with empty content after trim", () => {
    const input = [
      JSON.stringify({ message: { role: "user", content: "   " } }),
      JSON.stringify({ role: "assistant", content: "reply" }),
      JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "   " }] } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([{ role: "assistant", content: "reply" }]);
  });

  it("preserves turn order", () => {
    const input = [
      JSON.stringify({ message: { role: "user", content: "u1" } }),
      JSON.stringify({ message: { role: "assistant", content: "a1" } }),
      JSON.stringify({ message: { role: "user", content: "u2" } }),
      JSON.stringify({ message: { role: "assistant", content: "a2" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("normalizes Claude slash-command transcript entries", () => {
    const input = JSON.stringify({
      message: {
        role: "user",
        content:
          "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>",
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([{ role: "user", content: "/model" }]);
  });

  it("normalizes Claude local command stdout transcript entries", () => {
    const input = JSON.stringify({
      message: {
        role: "user",
        content:
          "<local-command-stdout>memory-mason is already at the latest version (0.1.2).</local-command-stdout>",
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([
      { role: "user", content: "memory-mason is already at the latest version (0.1.2)." },
    ]);
  });

  it("throws when content is not a non-empty string", () => {
    expect(() => parseJsonlTranscript("")).toThrow("content must be a non-empty string");
    expect(() => parseJsonlTranscript(123)).toThrow("content must be a non-empty string");
  });

  it("returns empty array for content with no valid turns", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "tool", content: "call" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([]);
  });

  it("ignores entries with unsupported content shapes", () => {
    const input = JSON.stringify({ message: { role: "user", content: { text: "ignored" } } });

    expect(parseJsonlTranscript(input)).toEqual([]);
  });
});

describe("filterMmTurns", () => {
  it("returns all turns when none start with /mm", () => {
    const turns = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];

    expect(filterMmTurns(turns)).toEqual(turns);
  });

  it("filters user turn starting with /mmc", () => {
    const turns = [{ role: "user", content: "/mmc" }];

    expect(filterMmTurns(turns)).toEqual([]);
  });

  it("filters user turn starting with /mmq", () => {
    const turns = [{ role: "user", content: "/mmq what changed" }];

    expect(filterMmTurns(turns)).toEqual([]);
  });

  it("also filters the next assistant turn after /mm user turn", () => {
    const turns = [
      { role: "user", content: "/mmc" },
      { role: "assistant", content: "done" },
      { role: "user", content: "normal" },
    ];

    expect(filterMmTurns(turns)).toEqual([{ role: "user", content: "normal" }]);
  });

  it("does not filter assistant turns not preceded by /mm user turn", () => {
    const turns = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "response" },
    ];

    expect(filterMmTurns(turns)).toEqual(turns);
  });

  it("handles two consecutive /mm turns - only next assistant skipped", () => {
    const turns = [
      { role: "user", content: "/mmc" },
      { role: "user", content: "/mmq question" },
      { role: "assistant", content: "hidden" },
      { role: "user", content: "normal" },
      { role: "assistant", content: "visible" },
    ];

    expect(filterMmTurns(turns)).toEqual([
      { role: "user", content: "normal" },
      { role: "assistant", content: "visible" },
    ]);
  });

  it("/mm user turn at end - no following assistant - still removes user turn", () => {
    const turns = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "/mma" },
    ];

    expect(filterMmTurns(turns)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "reply" },
    ]);
  });

  it("non-/mm user turn after /mm turn cancels pending assistant skip and is kept", () => {
    const turns = [
      { role: "user", content: "/mmc" },
      { role: "user", content: "normal user" },
      { role: "assistant", content: "visible reply" },
    ];

    expect(filterMmTurns(turns)).toEqual([
      { role: "user", content: "normal user" },
      { role: "assistant", content: "visible reply" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(filterMmTurns([])).toEqual([]);
  });

  it("throws when input is not an array", () => {
    expect(() => filterMmTurns(null)).toThrow("turns must be an array");
    expect(() => filterMmTurns("bad")).toThrow("turns must be an array");
  });
});

describe("selectRecentTurns", () => {
  it("returns last N turns when length exceeds maxTurns", () => {
    expect(selectRecentTurns([1, 2, 3, 4, 5], 2)).toEqual([4, 5]);
  });

  it("returns full copy when length is exactly maxTurns", () => {
    const turns = [1, 2, 3];
    const result = selectRecentTurns(turns, 3);

    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(turns);
  });

  it("returns full copy when length is less than maxTurns", () => {
    const turns = [1, 2];
    const result = selectRecentTurns(turns, 5);

    expect(result).toEqual([1, 2]);
    expect(result).not.toBe(turns);
  });

  it("does not mutate the input array", () => {
    const turns = ["a", "b", "c"];
    const snapshot = turns.slice();

    selectRecentTurns(turns, 2);

    expect(turns).toEqual(snapshot);
  });

  it("throws when turns is not an array", () => {
    expect(() => selectRecentTurns("not-array", 2)).toThrow("turns must be an array");
  });

  it("throws when maxTurns is 0", () => {
    expect(() => selectRecentTurns([1, 2], 0)).toThrow("maxTurns must be a positive integer");
  });

  it("throws when maxTurns is negative", () => {
    expect(() => selectRecentTurns([1, 2], -1)).toThrow("maxTurns must be a positive integer");
  });

  it("throws when maxTurns is a float", () => {
    expect(() => selectRecentTurns([1, 2], 1.5)).toThrow("maxTurns must be a positive integer");
  });
});

describe("renderTurnsAsMarkdown", () => {
  it("formats user turn with User label", () => {
    expect(renderTurnsAsMarkdown([{ role: "user", content: "hello" }])).toBe("**User:** hello\n");
  });

  it("formats assistant turn with Assistant label", () => {
    expect(renderTurnsAsMarkdown([{ role: "assistant", content: "world" }])).toBe(
      "**Assistant:** world\n",
    );
  });

  it("joins multiple turns with newline separator", () => {
    const result = renderTurnsAsMarkdown([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);

    expect(result).toBe("**User:** hello\n\n**Assistant:** world\n");
  });

  it("throws on empty array", () => {
    expect(() => renderTurnsAsMarkdown([])).toThrow("turns must be a non-empty array");
  });

  it("throws on invalid turn with missing role", () => {
    expect(() => renderTurnsAsMarkdown([{ content: "hello" }])).toThrow(
      "turn at index 0 has invalid role",
    );
  });

  it("throws on turn that is not an object", () => {
    expect(() => renderTurnsAsMarkdown([null])).toThrow("turn at index 0 must be an object");
  });

  it("throws on invalid turn with empty content", () => {
    expect(() => renderTurnsAsMarkdown([{ role: "user", content: "" }])).toThrow(
      "turn at index 0 must have non-empty content",
    );
  });
});

describe("buildFullTranscript", () => {
  it("returns empty markdown and 0 turn count for an empty transcript", () => {
    expect(buildFullTranscript("")).toEqual({ markdown: "", turnCount: 0 });
  });

  it("returns empty markdown and 0 turn count when there are no supported turns", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "tool", content: "call" } }),
    ].join("\n");

    expect(buildFullTranscript(input)).toEqual({ markdown: "", turnCount: 0 });
  });

  it("returns markdown and turn count for a single turn", () => {
    const input = JSON.stringify({ message: { role: "user", content: "hello" } });

    expect(buildFullTranscript(input)).toEqual({
      markdown: "**User:** hello\n",
      turnCount: 1,
    });
  });

  it("renders all turns without dropping older content", () => {
    const input = Array.from({ length: 40 }, (_, index) => {
      const turnNumber = index + 1;
      const role = turnNumber % 2 === 0 ? "assistant" : "user";
      const label = `turn-${String(turnNumber).padStart(2, "0")}`;
      return JSON.stringify({ message: { role, content: label } });
    }).join("\n");

    const result = buildFullTranscript(input);

    expect(result.turnCount).toBe(40);
    expect(result.markdown.includes("turn-01")).toBe(true);
    expect(result.markdown.includes("turn-40")).toBe(true);
  });

  it("keeps full content without applying character truncation", () => {
    const longContent = "x".repeat(20000);
    const input = JSON.stringify({ message: { role: "user", content: longContent } });

    const result = buildFullTranscript(input);

    expect(result.turnCount).toBe(1);
    expect(result.markdown.includes(longContent)).toBe(true);
    expect(result.markdown.includes("...(truncated)")).toBe(false);
  });

  it("includes non-assistant conversation turns and ignores unsupported roles", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "user", content: "question" } }),
      JSON.stringify({ message: { role: "tool", content: "call" } }),
      JSON.stringify({ message: { role: "assistant", content: "answer" } }),
    ].join("\n");

    expect(buildFullTranscript(input)).toEqual({
      markdown: "**User:** question\n\n**Assistant:** answer\n",
      turnCount: 2,
    });
  });
});

describe("buildTranscriptExcerpt", () => {
  it("returns markdown and turn count for valid JSONL", () => {
    const input = [
      JSON.stringify({ message: { role: "user", content: "hello" } }),
      JSON.stringify({ message: { role: "assistant", content: "world" } }),
    ].join("\n");

    expect(buildTranscriptExcerpt(input, 10, 1000)).toEqual({
      markdown: "**User:** hello\n\n**Assistant:** world\n",
      turnCount: 2,
    });
  });

  it("returns empty markdown and 0 turn count for JSONL with no valid turns", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "tool", content: "tool call" } }),
    ].join("\n");

    expect(buildTranscriptExcerpt(input, 5, 500)).toEqual({ markdown: "", turnCount: 0 });
  });

  it("applies truncation when markdown exceeds maxChars", () => {
    const marker = "\n\n...(truncated)";
    const input = JSON.stringify({
      message: {
        role: "user",
        content: "x".repeat(200),
      },
    });

    const result = buildTranscriptExcerpt(input, 5, 30);

    expect(result.turnCount).toBe(1);
    expect(result.markdown.endsWith(marker)).toBe(true);
    expect(result.markdown.length).toBe(30 + marker.length);
  });

  it("applies selectRecentTurns before rendering", () => {
    const lines = Array.from({ length: 10 }, (_, index) => {
      const turnNumber = index + 1;
      const role = turnNumber % 2 === 0 ? "assistant" : "user";
      const label = `turn-${String(turnNumber).padStart(2, "0")}`;
      return JSON.stringify({ message: { role, content: label } });
    });
    const input = lines.join("\n");

    const result = buildTranscriptExcerpt(input, 3, 1000);

    expect(result.turnCount).toBe(3);
    expect(result.markdown.includes("turn-10")).toBe(true);
    expect(result.markdown.includes("turn-01")).toBe(false);
  });
});
