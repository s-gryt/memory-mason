/**
 * This module handles constants logic.
 */
"use strict";

const TOKEN_CHARS_RATIO = 4;
const MAX_NARRATIVE_TOKENS = 500;
const MAX_NARRATIVE_CHARS = MAX_NARRATIVE_TOKENS * TOKEN_CHARS_RATIO;

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

module.exports = {
  TOKEN_CHARS_RATIO,
  MAX_NARRATIVE_TOKENS,
  MAX_NARRATIVE_CHARS,
  CAVEMAN_LITE_DROP_WORDS,
  CAVEMAN_LITE_DROP_PHRASES,
};
