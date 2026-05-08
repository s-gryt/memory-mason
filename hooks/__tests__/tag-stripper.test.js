"use strict";

const { stripMemoryTags, countMemoryTags } = require("../lib/tag-stripper");

const ZERO = 0;
const ONE = 1;
const THREE = 3;
const FOUR = 4;

describe("tag-stripper", () => {
  describe("stripMemoryTags", () => {
    it("strips system-reminder tags", () => {
      const input = "before<system-reminder>secret</system-reminder>after";
      expect(stripMemoryTags(input)).toBe("beforeafter");
    });

    it("strips system-instruction tags", () => {
      const input = "before<system-instruction>hidden</system-instruction>after";
      expect(stripMemoryTags(input)).toBe("beforeafter");
    });

    it("strips private tags", () => {
      const input = "before<private>hidden</private>after";
      expect(stripMemoryTags(input)).toBe("beforeafter");
    });

    it("strips persisted-output tags", () => {
      const input = "before<persisted-output>hidden</persisted-output>after";
      expect(stripMemoryTags(input)).toBe("beforeafter");
    });

    it("strips claude-mem-context tags", () => {
      const input = "before<claude-mem-context>hidden</claude-mem-context>after";
      expect(stripMemoryTags(input)).toBe("beforeafter");
    });

    it("strips system_instruction tags", () => {
      const input = "before<system_instruction>hidden</system_instruction>after";
      expect(stripMemoryTags(input)).toBe("beforeafter");
    });

    it("strips multiple different tags in one string", () => {
      const input = [
        "alpha",
        "<system-reminder>one</system-reminder>",
        "beta",
        "<private>two</private>",
        "gamma",
        "<persisted-output>three</persisted-output>",
        "omega",
      ].join("");

      expect(stripMemoryTags(input)).toBe("alphabetagammaomega");
    });

    it("supports tags with attributes", () => {
      const input = 'before<system-reminder type="text">hidden</system-reminder>after';
      expect(stripMemoryTags(input)).toBe("beforeafter");
    });

    it("leaves unsupported tags untouched", () => {
      const input = "<div>content</div>";
      expect(stripMemoryTags(input)).toBe("<div>content</div>");
    });

    it("returns trimmed empty string for tag-only content", () => {
      const input = "  <private>only</private>  ";
      expect(stripMemoryTags(input)).toBe("");
    });

    it("preserves non-tag content surrounding tags", () => {
      const input = "header <system-reminder>remove</system-reminder> footer";
      expect(stripMemoryTags(input)).toBe("header  footer");
    });

    it("throws TypeError on non-string input", () => {
      expect(() => stripMemoryTags(null)).toThrow(TypeError);
    });
  });

  describe("countMemoryTags", () => {
    it("counts total tags correctly", () => {
      const input = [
        "a<system-reminder>x</system-reminder>b",
        "<system-reminder>y</system-reminder>",
        "<system-reminder>z</system-reminder>",
      ].join("");

      expect(countMemoryTags(input)).toBe(THREE);
    });

    it("counts zero for content without tags", () => {
      expect(countMemoryTags("plain text")).toBe(ZERO);
    });

    it("counts across multiple different tag types", () => {
      const input = [
        "<system-reminder>a</system-reminder>",
        "<private>b</private>",
        "<system_instruction>c</system_instruction>",
        "<claude-mem-context>d</claude-mem-context>",
      ].join("");

      expect(countMemoryTags(input)).toBe(FOUR);
    });

    it("throws TypeError on non-string input", () => {
      expect(() => countMemoryTags(ONE)).toThrow(TypeError);
    });
  });
});
