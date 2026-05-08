"use strict";

const { compressNarrativeText } = require("../../lib/economics/compress");

const NON_STRING_INPUT = 42;
const HEADING_MATCH_PATTERN = /^#{1,6}\s/gm;
const BULLET_MATCH_PATTERN = /^\s*[-*+]\s|^\s*\d+\.\s/gm;

const runWithForcedStructureMismatch = (input, targetPattern) => {
  const compressed = compressNarrativeText(input);
  const originalMatch = String.prototype.match;
  const matchSpy = vi.spyOn(String.prototype, "match").mockImplementation(function (pattern) {
    const isTargetPattern =
      pattern instanceof RegExp &&
      pattern.source === targetPattern.source &&
      pattern.flags === targetPattern.flags;

    if (isTargetPattern && String(this) === compressed) {
      return null;
    }

    return originalMatch.call(this, pattern);
  });

  try {
    compressNarrativeText(input);
  } finally {
    matchSpy.mockRestore();
  }
};

describe("compressNarrativeText", () => {
  it("removes filler word 'just' from prose", () => {
    expect(compressNarrativeText("This is just a test")).toBe("This is a test");
  });

  it("removes filler word 'really'", () => {
    expect(compressNarrativeText("This is really important")).toBe("This is important");
  });

  it("removes phrase 'please note'", () => {
    const result = compressNarrativeText("Please note that this matters");
    expect(result).not.toContain("Please note");
    expect(result).toContain("that this matters");
  });

  it("removes phrase 'of course'", () => {
    const result = compressNarrativeText("Of course this works");
    expect(result).not.toContain("Of course");
  });

  it("removes multiple filler items", () => {
    const result = compressNarrativeText("Just really make sure to do this");
    expect(result.toLowerCase()).not.toContain("just");
    expect(result.toLowerCase()).not.toContain("really");
    expect(result.toLowerCase()).not.toContain("make sure to");
  });

  it("preserves fenced code block byte-for-byte", () => {
    const codeBlock = '```js\nconst x = "just really";\n```';
    const input = `Some prose\n${codeBlock}\nMore text`;
    const result = compressNarrativeText(input);
    expect(result).toContain(codeBlock);
  });

  it("preserves inline code spans", () => {
    const result = compressNarrativeText("Use `just` here");
    expect(result).toContain("`just`");
  });

  it("preserves URLs", () => {
    const url = "https://example.com/just-do-it";
    const result = compressNarrativeText(`See ${url} for details`);
    expect(result).toContain(url);
  });

  it("preserves markdown heading structure", () => {
    const result = compressNarrativeText("## Just a heading\nSome really long text");
    expect(result).toContain("## a heading");
    expect(result).not.toContain("really");
  });

  it("preserves markdown list bullets", () => {
    const result = compressNarrativeText("- Just do this\n- Really important item");
    expect(result).toContain("- ");
  });

  it("throws TypeError on non-string input", () => {
    expect(() => compressNarrativeText(NON_STRING_INPUT)).toThrow(TypeError);
    expect(() => compressNarrativeText(null)).toThrow(TypeError);
  });

  it("normalizes multiple spaces after removal", () => {
    const result = compressNarrativeText("This   has  extra   spaces");
    expect(result).not.toMatch(/ {2}/);
  });

  it("is case-insensitive for filler words", () => {
    const result = compressNarrativeText("JUST do it");
    expect(result.toLowerCase()).not.toContain("just");
  });

  it("respects word boundary - does not remove 'just' from 'justification'", () => {
    const result = compressNarrativeText("The justification is clear");
    expect(result).toContain("justification");
  });

  it("preserves double-quoted strings", () => {
    const result = compressNarrativeText('The value is "just really important"');
    expect(result).toContain('"just really important"');
  });

  it("preserves heading count after compression", () => {
    const input = "## First heading\nSome just text\n### Second heading\nMore really text";
    const result = compressNarrativeText(input);
    const originalHeadings = (input.match(/^#{1,6}\s/gm) || []).length;
    const resultHeadings = (result.match(/^#{1,6}\s/gm) || []).length;
    expect(resultHeadings).toBe(originalHeadings);
  });

  it("preserves bullet count after compression", () => {
    const input = "- Just first item\n- Really second item\n- Third item\n* Fourth item";
    const result = compressNarrativeText(input);
    const originalBullets = (input.match(/^\s*[-*+]\s|^\s*\d+\.\s/gm) || []).length;
    const resultBullets = (result.match(/^\s*[-*+]\s|^\s*\d+\.\s/gm) || []).length;
    expect(resultBullets).toBe(originalBullets);
  });

  it("preserves numbered list items after compression", () => {
    const input = "1. Just first\n2. Really second\n3. Third";
    const result = compressNarrativeText(input);
    const originalBullets = (input.match(/^\s*\d+\.\s/gm) || []).length;
    const resultBullets = (result.match(/^\s*\d+\.\s/gm) || []).length;
    expect(resultBullets).toBe(originalBullets);
  });

  it("throws validation error when protected segment check fails", () => {
    const codeBlock = "```\nsome just code\n```";
    const originalIncludes = String.prototype.includes;
    const includesSpy = vi.spyOn(String.prototype, "includes").mockImplementation(function (
      searchValue,
      ...rest
    ) {
      if (searchValue === codeBlock) {
        return false;
      }
      return originalIncludes.call(this, searchValue, ...rest);
    });

    try {
      expect(() => compressNarrativeText(codeBlock)).toThrow(
        "compress validation failed: protected segment altered",
      );
    } finally {
      includesSpy.mockRestore();
    }
  });

  it("throws validation error when heading count changes", () => {
    const input = "## Just first heading\nSome really long text\n### Really second heading";

    expect(() => runWithForcedStructureMismatch(input, HEADING_MATCH_PATTERN)).toThrow(
      "compress validation failed: heading count changed",
    );
  });

  it("throws validation error when bullet count falls outside tolerance", () => {
    const input = "- Just first item\n- Really second item\n- Third item\n* Fourth item";

    expect(() => runWithForcedStructureMismatch(input, BULLET_MATCH_PATTERN)).toThrow(
      "compress validation failed: bullet count outside tolerance",
    );
  });
});
