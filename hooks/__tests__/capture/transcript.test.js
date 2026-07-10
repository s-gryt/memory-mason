"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const {
  extractTagText,
  stripAnsiEscapeSequences,
  normalizeTranscriptText,
  collapseIntermediateAssistants,
  parseJsonlTranscript,
  filterMmTurns,
  selectRecentTurns,
  renderTurnsAsMarkdown,
  buildFullTranscript,
  buildTranscriptExcerpt,
} = require("../../lib/capture/transcript");
const {
  TEST_CAPTURE_MODE_LITE: CAPTURE_MODE_LITE,
  TEST_CAPTURE_MODE_FULL: CAPTURE_MODE_FULL,
  TEST_TRANSCRIPT_ROLE_USER: TRANSCRIPT_ROLE_USER,
  TEST_TRANSCRIPT_ROLE_ASSISTANT: TRANSCRIPT_ROLE_ASSISTANT,
  TEST_TRANSCRIPT_BLOCK_TYPE_TEXT: TRANSCRIPT_BLOCK_TYPE_TEXT,
  TEST_TRANSCRIPT_TYPE_USER_MESSAGE: TRANSCRIPT_TYPE_USER_MESSAGE,
  TEST_TRANSCRIPT_TYPE_ASSISTANT_MESSAGE: TRANSCRIPT_TYPE_ASSISTANT_MESSAGE,
  TEST_TRANSCRIPT_TYPE_SESSION_START: TRANSCRIPT_TYPE_SESSION_START,
  TEST_TRANSCRIPT_TYPE_ASSISTANT_TURN_START: TRANSCRIPT_TYPE_ASSISTANT_TURN_START,
  TEST_TRANSCRIPT_TYPE_ASSISTANT_TURN_END: TRANSCRIPT_TYPE_ASSISTANT_TURN_END,
} = require("../helpers/test-constants");

const TWO = 2;
const THREE = 3;
const FOUR = 4;
const FIVE = 5;
const TEN = 10;
const THIRTY = 30;
const FORTY = 40;
const TWO_HUNDRED = 200;
const FIVE_HUNDRED = 500;
const ONE_THOUSAND = 1000;
const TWO_THOUSAND = 2000;
const TWENTY_THOUSAND = 20000;
const ONE_POINT_FIVE = 1.5;
const NEGATIVE_ONE = -1;
const INVALID_NUMERIC_INPUT = 123;

const expectedHelloWorldTurns = [
  { role: TRANSCRIPT_ROLE_USER, content: "hello" },
  { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" },
];

const expectHelloWorldTranscript = (input) => {
  expect(parseJsonlTranscript(input)).toEqual(expectedHelloWorldTurns);
};

const loadTranscriptModuleWithInternals = () => {
  const transcriptPath = require.resolve("../../lib/capture/transcript");
  const transcriptSource = fs.readFileSync(transcriptPath, "utf-8");
  const transcriptModule = new Module(transcriptPath, module);
  transcriptModule.filename = transcriptPath;
  transcriptModule.paths = Module._nodeModulePaths(path.dirname(transcriptPath));
  transcriptModule._compile(
    `${transcriptSource}\nmodule.exports.__collapseAssistantRuns = collapseAssistantRuns;\n`,
    transcriptPath,
  );
  return transcriptModule.exports;
};

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

  it("preserves malformed ANSI CSI sequences", () => {
    const input = "Set model to \u001b[31XOpus";

    expect(stripAnsiEscapeSequences(input)).toBe(input);
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

  it("normalizes unprefixed Memory Mason command metadata into slash-prefixed prompt text", () => {
    const content = [
      "<command-message>memory-mason:mmc</command-message>",
      "<command-name>memory-mason:mmc</command-name>",
      "<command-args>today</command-args>",
    ].join("\n");

    expect(normalizeTranscriptText(content)).toBe("/memory-mason:mmc today");
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

describe("normalizeTranscriptText with captureMode", () => {
  it("preserves <thinking> block in lite mode", () => {
    const input = "a<thinking>hidden</thinking>b";

    expect(normalizeTranscriptText(input, CAPTURE_MODE_LITE)).toBe(input);
  });

  it("preserves <system-reminder> block in lite mode", () => {
    const input = "a<system-reminder>hidden</system-reminder>b";

    expect(normalizeTranscriptText(input, CAPTURE_MODE_LITE)).toBe(input);
  });

  it("preserves both tags and surrounding text in lite mode", () => {
    const input =
      "start<thinking>hidden-a</thinking>mid<system-reminder>hidden-b</system-reminder>end";

    expect(normalizeTranscriptText(input, CAPTURE_MODE_LITE)).toBe(input);
  });

  it("preserves multiple <thinking> blocks in lite mode", () => {
    const input = "x<thinking>a</thinking>y<thinking>b</thinking>z";

    expect(normalizeTranscriptText(input, CAPTURE_MODE_LITE)).toBe(input);
  });

  it("preserves <thinking> in full mode", () => {
    const input = "x<thinking>hidden</thinking>y";

    expect(normalizeTranscriptText(input, CAPTURE_MODE_FULL)).toBe(input);
  });

  it("preserves <system-reminder> in full mode", () => {
    const input = "x<system-reminder>hidden</system-reminder>y";

    expect(normalizeTranscriptText(input, CAPTURE_MODE_FULL)).toBe(input);
  });
});

describe("collapseIntermediateAssistants", () => {
  it("throws when input is not an array", () => {
    expect(() => collapseIntermediateAssistants(null)).toThrow("turns must be an array");
    expect(() => collapseIntermediateAssistants("str")).toThrow("turns must be an array");
  });

  it("returns empty array unchanged", () => {
    expect(collapseIntermediateAssistants([])).toEqual([]);
  });

  it("preserves alternating user and assistant turns", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" },
      { role: TRANSCRIPT_ROLE_USER, content: "u2" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2" },
    ];
    expect(collapseIntermediateAssistants(turns)).toEqual(turns);
  });

  it("collapses consecutive assistant turns keeping only last", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "intermediate 1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "intermediate 2" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "final answer" },
    ];
    expect(collapseIntermediateAssistants(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "final answer" },
    ]);
  });

  it("collapses multiple consecutive assistant runs independently", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1-inter" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1-final" },
      { role: TRANSCRIPT_ROLE_USER, content: "u2" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2-inter" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2-final" },
    ];
    expect(collapseIntermediateAssistants(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1-final" },
      { role: TRANSCRIPT_ROLE_USER, content: "u2" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2-final" },
    ]);
  });

  it("keeps trailing assistant turn when no following user turn", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "inter" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "last" },
    ];
    expect(collapseIntermediateAssistants(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "last" },
    ]);
  });

  it("handles single assistant turn without preceding user turn", () => {
    const turns = [{ role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" }];
    expect(collapseIntermediateAssistants(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" },
    ]);
  });

  it("returns empty for assistant runs with no turns", () => {
    const transcriptModule = loadTranscriptModuleWithInternals();

    expect(
      transcriptModule.__collapseAssistantRuns([{ role: TRANSCRIPT_ROLE_ASSISTANT, turns: [] }]),
    ).toEqual([]);
  });
});

describe("parseJsonlTranscript", () => {
  it("parses Claude-style JSONL with message.role and string content", () => {
    const input = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "hello" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" } }),
    ].join("\n");

    expectHelloWorldTranscript(input);
  });

  it("parses block-array content and concatenates text blocks", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_USER,
        content: [
          { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "hello" },
          { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "world" },
        ],
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "hello\nworld" },
    ]);
  });

  it("skips non-text blocks in block array", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_USER,
        content: [
          { type: "tool_use", name: "something" },
          { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "first" },
          { type: "tool_result", result: "ignored" },
          { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "second" },
        ],
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "first\nsecond" },
    ]);
  });

  it("parses flat format with top-level role and content", () => {
    const input = JSON.stringify({ role: TRANSCRIPT_ROLE_USER, content: "test" });

    expect(parseJsonlTranscript(input)).toEqual([{ role: TRANSCRIPT_ROLE_USER, content: "test" }]);
  });

  it("parses VS Code transcript entries with type and data content", () => {
    const input = [
      JSON.stringify({
        id: "entry-0",
        timestamp: "2025-01-01T00:00:00.000Z",
        parentId: null,
        type: TRANSCRIPT_TYPE_SESSION_START,
        data: { sessionId: "session-1" },
      }),
      JSON.stringify({
        id: "entry-1",
        timestamp: "2025-01-01T00:00:01.000Z",
        parentId: "entry-0",
        type: TRANSCRIPT_TYPE_USER_MESSAGE,
        data: { content: "hello", attachments: [] },
      }),
      JSON.stringify({
        id: "entry-2",
        timestamp: "2025-01-01T00:00:02.000Z",
        parentId: "entry-1",
        type: TRANSCRIPT_TYPE_ASSISTANT_TURN_START,
        data: { turnId: "0.0" },
      }),
      JSON.stringify({
        id: "entry-3",
        timestamp: "2025-01-01T00:00:03.000Z",
        parentId: "entry-2",
        type: TRANSCRIPT_TYPE_ASSISTANT_MESSAGE,
        data: { messageId: "message-1", content: "world", toolRequests: [] },
      }),
      JSON.stringify({
        id: "entry-4",
        timestamp: "2025-01-01T00:00:04.000Z",
        parentId: "entry-3",
        type: TRANSCRIPT_TYPE_ASSISTANT_TURN_END,
        data: { turnId: "0.0" },
      }),
    ].join("\n");

    expectHelloWorldTranscript(input);
  });

  it("ignores VS Code transcript message entries with malformed data payloads", () => {
    const input = JSON.stringify({
      id: "entry-1",
      timestamp: "2025-01-01T00:00:01.000Z",
      parentId: null,
      type: TRANSCRIPT_TYPE_ASSISTANT_MESSAGE,
      data: "invalid",
    });

    expect(parseJsonlTranscript(input)).toEqual([]);
  });

  it("ignores blank lines", () => {
    const input = [
      "",
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "hello" } }),
      "",
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" } }),
      "",
    ].join("\n");

    expectHelloWorldTranscript(input);
  });

  it("ignores malformed JSON lines", () => {
    const input = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "hello" } }),
      "{not-json",
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" } }),
    ].join("\n");

    expectHelloWorldTranscript(input);
  });

  it("ignores system and tool roles", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "tool", content: "call" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "question" },
    ]);
  });

  it("ignores parsed JSON values that are not objects", () => {
    const input = [
      "123",
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" },
    ]);
  });

  it("ignores entries with empty content after trim", () => {
    const input = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "   " } }),
      JSON.stringify({ role: TRANSCRIPT_ROLE_ASSISTANT, content: "reply" }),
      JSON.stringify({
        message: {
          role: TRANSCRIPT_ROLE_ASSISTANT,
          content: [{ type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "   " }],
        },
      }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "reply" },
    ]);
  });

  it("preserves turn order", () => {
    const input = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "u1" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "u2" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "u1" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a1" },
      { role: TRANSCRIPT_ROLE_USER, content: "u2" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "a2" },
    ]);
  });

  it("normalizes Claude slash-command transcript entries", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_USER,
        content:
          "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>",
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "/model" },
    ]);
  });

  it("normalizes Claude local command stdout transcript entries", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_USER,
        content:
          "<local-command-stdout>memory-mason is already at the latest version (0.1.2).</local-command-stdout>",
      },
    });

    expect(parseJsonlTranscript(input)).toEqual([
      {
        role: TRANSCRIPT_ROLE_USER,
        content: "memory-mason is already at the latest version (0.1.2).",
      },
    ]);
  });

  it("throws when content is not a non-empty string", () => {
    expect(() => parseJsonlTranscript("")).toThrow("content must be a non-empty string");
    expect(() => parseJsonlTranscript(INVALID_NUMERIC_INPUT)).toThrow(
      "content must be a non-empty string",
    );
  });

  it("returns empty array for content with no valid turns", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "tool", content: "call" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input)).toEqual([]);
  });

  it("ignores entries with unsupported content shapes", () => {
    const input = JSON.stringify({
      message: { role: TRANSCRIPT_ROLE_USER, content: { text: "ignored" } },
    });

    expect(parseJsonlTranscript(input)).toEqual([]);
  });

  it("collapses consecutive assistant turns in lite mode", () => {
    const input = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "thinking..." } }),
      JSON.stringify({
        message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "intermediate step" },
      }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "final answer" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input, CAPTURE_MODE_LITE)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "question" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "final answer" },
    ]);
  });

  it("preserves all consecutive assistant turns in full mode", () => {
    const input = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "thinking..." } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "final answer" } }),
    ].join("\n");

    expect(parseJsonlTranscript(input, CAPTURE_MODE_FULL)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "question" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "thinking..." },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "final answer" },
    ]);
  });
});

describe("parseJsonlTranscript with captureMode", () => {
  it("preserves tags from string content in lite", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_ASSISTANT,
        content: "visible<thinking>hidden</thinking>",
      },
    });

    expect(parseJsonlTranscript(input, CAPTURE_MODE_LITE)).toEqual([
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible<thinking>hidden</thinking>" },
    ]);
  });

  it("preserves tags from block-array content in lite", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_ASSISTANT,
        content: [
          { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "a<system-reminder>hidden</system-reminder>b" },
          { type: TRANSCRIPT_BLOCK_TYPE_TEXT, text: "<thinking>secret</thinking>c" },
        ],
      },
    });

    expect(parseJsonlTranscript(input, CAPTURE_MODE_LITE)).toEqual([
      {
        role: TRANSCRIPT_ROLE_ASSISTANT,
        content: "a<system-reminder>hidden</system-reminder>b\n<thinking>secret</thinking>c",
      },
    ]);
  });

  it("preserves tags in full mode", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_ASSISTANT,
        content: "visible<thinking>hidden</thinking>",
      },
    });

    expect(parseJsonlTranscript(input, CAPTURE_MODE_FULL)).toEqual([
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible<thinking>hidden</thinking>" },
    ]);
  });
});

describe("filterMmTurns", () => {
  it("returns all turns when none start with /mm", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "hello" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "hi" },
    ];

    expect(filterMmTurns(turns)).toEqual(turns);
  });

  it("filters user turn starting with /mmc", () => {
    const turns = [{ role: TRANSCRIPT_ROLE_USER, content: "/mmc" }];

    expect(filterMmTurns(turns)).toEqual([]);
  });

  it("filters user turn starting with /mmq", () => {
    const turns = [{ role: TRANSCRIPT_ROLE_USER, content: "/mmq what changed" }];

    expect(filterMmTurns(turns)).toEqual([]);
  });

  it("filters user turn starting with /memory-mason:mmc", () => {
    const turns = [{ role: TRANSCRIPT_ROLE_USER, content: "/memory-mason:mmc" }];

    expect(filterMmTurns(turns)).toEqual([]);
  });

  it("filters user turn starting with /memory-mason:mmsetup", () => {
    const turns = [{ role: TRANSCRIPT_ROLE_USER, content: "/memory-mason:mmsetup repo" }];

    expect(filterMmTurns(turns)).toEqual([]);
  });

  it("filters user turn parsed from unprefixed Memory Mason command metadata", () => {
    const turns = parseJsonlTranscript(
      JSON.stringify({
        message: {
          role: TRANSCRIPT_ROLE_USER,
          content: "<command-name>memory-mason:mmc</command-name>",
        },
      }),
    );

    expect(filterMmTurns(turns)).toEqual([]);
  });

  it("does not filter unknown /mm-style user turn", () => {
    const turns = [{ role: TRANSCRIPT_ROLE_USER, content: "/mmwhatever repo" }];

    expect(filterMmTurns(turns)).toEqual(turns);
  });

  it("also filters the next assistant turn after /mm user turn", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "/mmc" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "done" },
      { role: TRANSCRIPT_ROLE_USER, content: "normal" },
    ];

    expect(filterMmTurns(turns)).toEqual([{ role: TRANSCRIPT_ROLE_USER, content: "normal" }]);
  });

  it("also filters the next assistant turn after /memory-mason user turn", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "/memory-mason:mmq what changed" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "hidden" },
      { role: TRANSCRIPT_ROLE_USER, content: "normal" },
    ];

    expect(filterMmTurns(turns)).toEqual([{ role: TRANSCRIPT_ROLE_USER, content: "normal" }]);
  });

  it("filters every assistant turn after an /mm user turn until the next user turn", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "/mmc" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "hidden intermediate" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "hidden final" },
      { role: TRANSCRIPT_ROLE_USER, content: "normal user" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible reply" },
    ];

    expect(filterMmTurns(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "normal user" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible reply" },
    ]);
  });

  it("does not filter assistant turns not preceded by /mm user turn", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "hi" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "response" },
    ];

    expect(filterMmTurns(turns)).toEqual(turns);
  });

  it("handles two consecutive /mm turns - only next assistant skipped", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "/mmc" },
      { role: TRANSCRIPT_ROLE_USER, content: "/mmq question" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "hidden" },
      { role: TRANSCRIPT_ROLE_USER, content: "normal" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible" },
    ];

    expect(filterMmTurns(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "normal" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible" },
    ]);
  });

  it("/mm user turn at end - no following assistant - still removes user turn", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "hello" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "reply" },
      { role: TRANSCRIPT_ROLE_USER, content: "/mma" },
    ];

    expect(filterMmTurns(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "hello" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "reply" },
    ]);
  });

  it("non-/mm user turn after /mm turn cancels pending assistant skip and is kept", () => {
    const turns = [
      { role: TRANSCRIPT_ROLE_USER, content: "/mmc" },
      { role: TRANSCRIPT_ROLE_USER, content: "normal user" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible reply" },
    ];

    expect(filterMmTurns(turns)).toEqual([
      { role: TRANSCRIPT_ROLE_USER, content: "normal user" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "visible reply" },
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
    expect(selectRecentTurns([1, TWO, THREE, FOUR, FIVE], TWO)).toEqual([FOUR, FIVE]);
  });

  it("returns full copy when length is exactly maxTurns", () => {
    const turns = [1, TWO, THREE];
    const result = selectRecentTurns(turns, THREE);

    expect(result).toEqual([1, TWO, THREE]);
    expect(result).not.toBe(turns);
  });

  it("returns full copy when length is less than maxTurns", () => {
    const turns = [1, TWO];
    const result = selectRecentTurns(turns, FIVE);

    expect(result).toEqual([1, TWO]);
    expect(result).not.toBe(turns);
  });

  it("does not mutate the input array", () => {
    const turns = ["a", "b", "c"];
    const snapshot = turns.slice();

    selectRecentTurns(turns, TWO);

    expect(turns).toEqual(snapshot);
  });

  it("throws when turns is not an array", () => {
    expect(() => selectRecentTurns("not-array", TWO)).toThrow("turns must be an array");
  });

  it("throws when maxTurns is 0", () => {
    expect(() => selectRecentTurns([1, TWO], 0)).toThrow("maxTurns must be a positive integer");
  });

  it("throws when maxTurns is negative", () => {
    expect(() => selectRecentTurns([1, TWO], NEGATIVE_ONE)).toThrow(
      "maxTurns must be a positive integer",
    );
  });

  it("throws when maxTurns is a float", () => {
    expect(() => selectRecentTurns([1, TWO], ONE_POINT_FIVE)).toThrow(
      "maxTurns must be a positive integer",
    );
  });
});

describe("renderTurnsAsMarkdown", () => {
  it("formats user turn with User label", () => {
    expect(renderTurnsAsMarkdown([{ role: TRANSCRIPT_ROLE_USER, content: "hello" }])).toBe(
      "**User:** hello\n",
    );
  });

  it("formats assistant turn with Assistant label", () => {
    expect(renderTurnsAsMarkdown([{ role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" }])).toBe(
      "**Assistant:** world\n",
    );
  });

  it("joins multiple turns with newline separator", () => {
    const result = renderTurnsAsMarkdown([
      { role: TRANSCRIPT_ROLE_USER, content: "hello" },
      { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" },
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
    expect(() => renderTurnsAsMarkdown([{ role: TRANSCRIPT_ROLE_USER, content: "" }])).toThrow(
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
    const input = JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "hello" } });

    expect(buildFullTranscript(input)).toEqual({
      markdown: "**User:** hello\n",
      turnCount: 1,
    });
  });

  it("renders all turns without dropping older content", () => {
    const input = Array.from({ length: FORTY }, (_, index) => {
      const turnNumber = index + 1;
      const role = turnNumber % TWO === 0 ? TRANSCRIPT_ROLE_ASSISTANT : TRANSCRIPT_ROLE_USER;
      const label = `turn-${String(turnNumber).padStart(TWO, "0")}`;
      return JSON.stringify({ message: { role, content: label } });
    }).join("\n");

    const result = buildFullTranscript(input);

    expect(result.turnCount).toBe(FORTY);
    expect(result.markdown.includes("turn-01")).toBe(true);
    expect(result.markdown.includes("turn-40")).toBe(true);
  });

  it("keeps full content without applying character truncation", () => {
    const longContent = "x".repeat(TWENTY_THOUSAND);
    const input = JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: longContent } });

    const result = buildFullTranscript(input);

    expect(result.turnCount).toBe(1);
    expect(result.markdown.includes(longContent)).toBe(true);
    expect(result.markdown.includes("...(truncated)")).toBe(false);
  });

  it("includes non-assistant conversation turns and ignores unsupported roles", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "question" } }),
      JSON.stringify({ message: { role: "tool", content: "call" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "answer" } }),
    ].join("\n");

    expect(buildFullTranscript(input)).toEqual({
      markdown: "**User:** question\n\n**Assistant:** answer\n",
      turnCount: TWO,
    });
  });
});

describe("buildFullTranscript with captureMode", () => {
  it("passes captureMode through, full mode preserves tags", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_ASSISTANT,
        content: "reply<thinking>hidden</thinking>",
      },
    });

    const result = buildFullTranscript(input, CAPTURE_MODE_FULL);

    expect(result.turnCount).toBe(1);
    expect(result.markdown).toContain("<thinking>hidden</thinking>");
  });
});

describe("buildTranscriptExcerpt", () => {
  it("returns markdown and turn count for valid JSONL", () => {
    const input = [
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_USER, content: "hello" } }),
      JSON.stringify({ message: { role: TRANSCRIPT_ROLE_ASSISTANT, content: "world" } }),
    ].join("\n");

    expect(buildTranscriptExcerpt(input, TEN, ONE_THOUSAND)).toEqual({
      markdown: "**User:** hello\n\n**Assistant:** world\n",
      turnCount: TWO,
    });
  });

  it("returns empty markdown and 0 turn count for JSONL with no valid turns", () => {
    const input = [
      JSON.stringify({ message: { role: "system", content: "policy" } }),
      JSON.stringify({ message: { role: "tool", content: "tool call" } }),
    ].join("\n");

    expect(buildTranscriptExcerpt(input, FIVE, FIVE_HUNDRED)).toEqual({
      markdown: "",
      turnCount: 0,
    });
  });

  it("applies truncation when markdown exceeds maxChars", () => {
    const marker = "\n\n...(truncated)";
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_USER,
        content: "x".repeat(TWO_HUNDRED),
      },
    });

    const result = buildTranscriptExcerpt(input, FIVE, THIRTY);

    expect(result.turnCount).toBe(1);
    expect(result.markdown.endsWith(marker)).toBe(true);
    expect(result.markdown.length).toBe(THIRTY + marker.length);
  });

  it("applies selectRecentTurns before rendering", () => {
    const lines = Array.from({ length: TEN }, (_, index) => {
      const turnNumber = index + 1;
      const role = turnNumber % TWO === 0 ? TRANSCRIPT_ROLE_ASSISTANT : TRANSCRIPT_ROLE_USER;
      const label = `turn-${String(turnNumber).padStart(TWO, "0")}`;
      return JSON.stringify({ message: { role, content: label } });
    });
    const input = lines.join("\n");

    const result = buildTranscriptExcerpt(input, THREE, ONE_THOUSAND);

    expect(result.turnCount).toBe(THREE);
    expect(result.markdown.includes("turn-10")).toBe(true);
    expect(result.markdown.includes("turn-01")).toBe(false);
  });
});

describe("buildTranscriptExcerpt with captureMode", () => {
  it("passes captureMode through, full mode preserves tags", () => {
    const input = JSON.stringify({
      message: {
        role: TRANSCRIPT_ROLE_ASSISTANT,
        content: "reply<thinking>hidden</thinking>",
      },
    });

    const result = buildTranscriptExcerpt(input, FIVE, TWO_THOUSAND, CAPTURE_MODE_FULL);

    expect(result.turnCount).toBe(1);
    expect(result.markdown).toContain("<thinking>hidden</thinking>");
  });
});
