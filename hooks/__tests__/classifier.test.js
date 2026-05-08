"use strict";

const { classifyToolEvent } = require("../lib/classifier");
const { countMemoryTags } = require("../lib/tag-stripper");
const {
  EVENT_TYPE_ERROR,
  EVENT_TYPE_TEST_RESULT,
  EVENT_TYPE_PLAN_OUTPUT,
  EVENT_TYPE_AGENT_RESULT,
  EVENT_TYPE_DISCOVERY,
  EVENT_TYPE_DECISION,
  EVENT_TYPE_EXPLORATION,
  EVENT_TYPE_META,
  EVENT_TYPE_NOISE,
} = require("../lib/constants");

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const TWENTY_ONE = 21;
const ANSI_ONLY_OUTPUT = "\x1B[32m\x1B[0m";
const MEMORY_TAG_ONLY_OUTPUT = "<system-reminder>foo</system-reminder>";
const DEFAULT_CAPTURE_MODE = "lite";

const DEFAULT_INPUT = Object.freeze({
  toolName: "",
  exitCode: undefined,
  output: "ok",
  filePath: "",
  lineCount: ZERO,
  captureMode: DEFAULT_CAPTURE_MODE,
  commandText: "",
});

const createInput = (overrides = {}) => ({
  ...DEFAULT_INPUT,
  ...overrides,
});

describe("classifyToolEvent", () => {
  it("classifies tests passed output as test_result", () => {
    expect(classifyToolEvent(createInput({ output: `${FIVE} tests passed` }))).toBe(
      EVENT_TYPE_TEST_RESULT,
    );
  });

  it("classifies tests failed output as test_result before error", () => {
    expect(classifyToolEvent(createInput({ output: `${THREE} tests failed` }))).toBe(
      EVENT_TYPE_TEST_RESULT,
    );
  });

  it("classifies passed suffix output as test_result", () => {
    expect(classifyToolEvent(createInput({ output: `${TEN} passed` }))).toBe(
      EVENT_TYPE_TEST_RESULT,
    );
  });

  it("classifies assertion output as test_result", () => {
    expect(classifyToolEvent(createInput({ output: "assertion" }))).toBe(EVENT_TYPE_TEST_RESULT);
  });

  it("classifies non-zero numeric exitCode as error", () => {
    expect(classifyToolEvent(createInput({ exitCode: ONE, output: "ok" }))).toBe(EVENT_TYPE_ERROR);
  });

  it("classifies Error token output as error even with zero exitCode", () => {
    expect(classifyToolEvent(createInput({ exitCode: ZERO, output: "Error: boom" }))).toBe(
      EVENT_TYPE_ERROR,
    );
  });

  it("classifies FAIL token output as error", () => {
    expect(classifyToolEvent(createInput({ output: "FAIL" }))).toBe(EVENT_TYPE_ERROR);
  });

  it("classifies empty output as noise", () => {
    expect(classifyToolEvent(createInput({ output: "" }))).toBe(EVENT_TYPE_NOISE);
  });

  it("classifies ANSI-only output as noise", () => {
    expect(classifyToolEvent(createInput({ output: ANSI_ONLY_OUTPUT }))).toBe(EVENT_TYPE_NOISE);
  });

  it("classifies memory-tag-only output as noise", () => {
    expect(classifyToolEvent(createInput({ output: MEMORY_TAG_ONLY_OUTPUT }))).toBe(
      EVENT_TYPE_NOISE,
    );
  });

  it("classifies write into plan path as plan_output", () => {
    expect(
      classifyToolEvent(
        createInput({
          toolName: "Write",
          filePath: ".claude/plans/my-plan.md",
        }),
      ),
    ).toBe(EVENT_TYPE_PLAN_OUTPUT);
  });

  it("normalizes Windows separators for plan_output classification", () => {
    expect(
      classifyToolEvent(
        createInput({
          toolName: "Write",
          filePath: ".claude\\plans\\my-plan.md",
        }),
      ),
    ).toBe(EVENT_TYPE_PLAN_OUTPUT);
  });

  it("classifies Task as agent_result", () => {
    expect(classifyToolEvent(createInput({ toolName: "Task" }))).toBe(EVENT_TYPE_AGENT_RESULT);
  });

  it("classifies Agent as agent_result", () => {
    expect(classifyToolEvent(createInput({ toolName: "Agent" }))).toBe(EVENT_TYPE_AGENT_RESULT);
  });

  it("classifies write tools above discovery threshold as discovery", () => {
    expect(classifyToolEvent(createInput({ toolName: "Create", lineCount: TWENTY_ONE }))).toBe(
      EVENT_TYPE_DISCOVERY,
    );
  });

  it("does not classify lineCount equal threshold as discovery", () => {
    expect(classifyToolEvent(createInput({ toolName: "MultiEdit", lineCount: TWENTY }))).toBe(
      EVENT_TYPE_NOISE,
    );
  });

  it("classifies AskUserQuestion as decision before meta", () => {
    expect(classifyToolEvent(createInput({ toolName: "AskUserQuestion" }))).toBe(
      EVENT_TYPE_DECISION,
    );
  });

  it("classifies noisy Read tool as exploration", () => {
    expect(classifyToolEvent(createInput({ toolName: "Read" }))).toBe(EVENT_TYPE_EXPLORATION);
  });

  it("classifies noisy Glob tool as exploration", () => {
    expect(classifyToolEvent(createInput({ toolName: "Glob" }))).toBe(EVENT_TYPE_EXPLORATION);
  });

  it("classifies Bash grep command as exploration", () => {
    expect(classifyToolEvent(createInput({ toolName: "Bash", commandText: "grep foo.ts" }))).toBe(
      EVENT_TYPE_EXPLORATION,
    );
  });

  it("classifies lowercase bash ls command as exploration", () => {
    expect(classifyToolEvent(createInput({ toolName: "bash", commandText: "ls -la" }))).toBe(
      EVENT_TYPE_EXPLORATION,
    );
  });

  it("classifies TodoWrite as meta", () => {
    expect(classifyToolEvent(createInput({ toolName: "TodoWrite" }))).toBe(EVENT_TYPE_META);
  });

  it("classifies Skill as meta", () => {
    expect(classifyToolEvent(createInput({ toolName: "Skill" }))).toBe(EVENT_TYPE_META);
  });

  it("falls back to noise when no rule matches", () => {
    expect(
      classifyToolEvent(createInput({ toolName: "Write", lineCount: FIVE, output: "ok" })),
    ).toBe(EVENT_TYPE_NOISE);
  });

  it.each([null, "invalid"])("throws TypeError when input is not an object: %s", (input) => {
    expect(() => classifyToolEvent(input)).toThrow(TypeError);
  });

  it("normalizes invalid scalar fields to safe defaults", () => {
    expect(
      classifyToolEvent(
        createInput({
          toolName: null,
          output: null,
          filePath: null,
          lineCount: null,
          commandText: null,
        }),
      ),
    ).toBe(EVENT_TYPE_NOISE);
  });

  it("does not classify bash non-exploration command as exploration", () => {
    expect(classifyToolEvent(createInput({ toolName: "bash", commandText: "echo hello" }))).toBe(
      EVENT_TYPE_NOISE,
    );
  });

  it("counts removable memory tags for dependent helper coverage", () => {
    const content = "<private>x</private><system-reminder>y</system-reminder>";
    expect(countMemoryTags(content)).toBe(TWO);
  });

  it("throws TypeError when counting tags on non-string input", () => {
    expect(() => countMemoryTags(ZERO)).toThrow(TypeError);
  });
});
