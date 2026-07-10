"use strict";

const { compressNarrativeText } = require("../../lib/economics/compress");

const NON_STRING_INPUT = 42;
const HEADING_MATCH_PATTERN = /^#{1,6}\s/gm;
const BULLET_MATCH_PATTERN = /^\s*[-*+]\s|^\s*\d+\.\s/gm;

const runWithForcedStructureMismatch = (input, targetPattern) => {
  const originalMatch = String.prototype.match;
  let targetCallCount = 0;
  const matchSpy = vi.spyOn(String.prototype, "match").mockImplementation(function (pattern) {
    const isTargetPattern =
      pattern instanceof RegExp &&
      pattern.source === targetPattern.source &&
      pattern.flags === targetPattern.flags;

    if (isTargetPattern) {
      targetCallCount += 1;
      if (targetCallCount === 2) {
        return null;
      }
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
  it("preserves filler word 'just' from prose", () => {
    expect(compressNarrativeText("This is just a test")).toBe("This is just a test");
  });

  it("preserves filler word 'really'", () => {
    expect(compressNarrativeText("This is really important")).toBe("This is really important");
  });

  it("preserves phrase 'please note'", () => {
    const result = compressNarrativeText("Please note that this matters");
    expect(result).toBe("Please note that this matters");
  });

  it("preserves phrase 'of course'", () => {
    const result = compressNarrativeText("Of course this works");
    expect(result).toBe("Of course this works");
  });

  it("respects phrase boundaries and does not corrupt larger words", () => {
    const result = compressNarrativeText("The coefficient of coursework stayed unchanged");
    expect(result).toBe("The coefficient of coursework stayed unchanged");
  });

  it("preserves multiple filler items and 'make sure to'", () => {
    const result = compressNarrativeText("Just really make sure to do this");
    expect(result).toBe("Just really make sure to do this");
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
    expect(result).toContain("## Just a heading");
    expect(result).toContain("really");
  });

  it("preserves markdown list bullets", () => {
    const result = compressNarrativeText("- Just do this\n- Really important item");
    expect(result).toContain("- ");
  });

  it("preserves nested markdown list indentation", () => {
    const input = "- top\n  - nested";

    expect(compressNarrativeText(input)).toBe(input);
  });

  it("collapses multi-space indentation on non-structured prose lines to a single space", () => {
    expect(compressNarrativeText("a\n  plain text")).toBe("a\n plain text");
  });

  it("preserves filler words and punctuation", () => {
    expect(compressNarrativeText("This is just a simple test, actually.")).toBe(
      "This is just a simple test, actually.",
    );
  });

  it("throws TypeError on non-string input", () => {
    expect(() => compressNarrativeText(NON_STRING_INPUT)).toThrow(TypeError);
    expect(() => compressNarrativeText(null)).toThrow(TypeError);
  });

  it("preserves markdown hard line breaks (two trailing spaces) while collapsing internal spaces", () => {
    const input = "Keep this   line here  \nSecond line";
    const result = compressNarrativeText(input);
    const firstLine = result.split("\n")[0];
    expect(firstLine).toBe("Keep this line here  ");
  });

  it("normalizes multiple spaces", () => {
    const result = compressNarrativeText("This   has  extra   spaces");
    expect(result).not.toMatch(/ {2}/);
  });

  it("preserves uppercase filler words", () => {
    const result = compressNarrativeText("JUST do it");
    expect(result).toBe("JUST do it");
  });

  it("respects word boundary - does not remove 'just' from 'justification'", () => {
    const result = compressNarrativeText("The justification is clear");
    expect(result).toContain("justification");
  });

  it("preserves double-quoted strings", () => {
    const result = compressNarrativeText('The value is "just really important"');
    expect(result).toContain('"just really important"');
  });

  it("preserves nested protected segments inside quoted strings", () => {
    const input = 'He said "run `npm i` first" then stop.';

    expect(compressNarrativeText(input)).toBe(input);
  });

  it("preserves quoted URLs without falling back to a validation error", () => {
    const input = 'docs at "https://example.com" now';

    expect(compressNarrativeText(input)).toBe(input);
  });

  it("preserves 'be sure to' guidance", () => {
    const input = "Please note: be sure to run the migration first.";

    expect(compressNarrativeText(input)).toContain("be sure to run the migration first.");
  });

  it("does not let quote protection span across newlines", () => {
    const input = '"just\nreally" make sure to deploy';

    expect(compressNarrativeText(input)).toBe(input);
  });

  it("does not remove filler words from hyphenated compounds", () => {
    const input = "just-in-time and sure-fire";

    expect(compressNarrativeText(input)).toBe(input);
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
    const originalIndexOf = String.prototype.indexOf;
    const indexOfSpy = vi.spyOn(String.prototype, "indexOf").mockImplementation(function (
      searchValue,
      ...rest
    ) {
      if (searchValue === codeBlock) {
        return -1;
      }
      return originalIndexOf.call(this, searchValue, ...rest);
    });

    try {
      expect(() => compressNarrativeText(codeBlock)).toThrow(
        "compress validation failed: protected segment altered",
      );
    } finally {
      indexOfSpy.mockRestore();
    }
  });

  it("preserves exact indentation of fenced and 4-space indented code blocks after compression", () => {
    const fenced = "```js\nconst x = 1;\n    const y = 2;\n```";
    const indented = "    const z = 3;\n    const w = 4;";
    const input = `Some just prose\n${fenced}\nMore really text\n${indented}`;
    const result = compressNarrativeText(input);
    expect(result).toContain(fenced);
    expect(result).toContain(indented);
  });

  it("preserves indented code lines that start with punctuation", () => {
    const indented = "    ; sql-comment\n    .then(run)";
    const input = `Some just prose\n${indented}\nMore really text`;

    expect(compressNarrativeText(input)).toContain(indented);
  });

  it("validates occurrence count so duplicate protected segments are not silently dropped", () => {
    const url = "https://example.com/path";
    const input = `See ${url} and also ${url} for details`;
    const result = compressNarrativeText(input);
    const occurrences = result.split(url).length - 1;
    expect(occurrences).toBe(2);
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

  it("collapses ', .' sequence to '.' and retains surrounding words", () => {
    const result = compressNarrativeText("Hello, . world");
    expect(result).toBe("Hello. world");
  });

  it("strips leading whitespace before a comma and preserves the following word", () => {
    const result = compressNarrativeText("text\n , more");
    expect(result).toBe("text\n, more");
  });

  it("leaves fenced code block byte-for-byte intact when prose contains ', .' and leading-space punctuation", () => {
    const codeBlock = "```js\nconst x = 1, . y;\n```";
    const input = `intro\n${codeBlock}\n , end`;
    const result = compressNarrativeText(input);
    expect(result).toContain(codeBlock);
    expect(result).toContain(", end");
  });
});
