/**
 * This module handles constants logic.
 */
"use strict";

const HOOK_EVENT_STOP = "stop";
const STDIN_BUFFER_BYTES = 65536;
const PRE_COMPACT_MIN_TURNS = 5;
const HOOK_FILES = [
  "session-start.json",
  "user-prompt-submit.json",
  "post-tool-use.json",
  "pre-compact.json",
  "stop.json",
  "session-end.json",
];

module.exports = {
  HOOK_EVENT_STOP,
  STDIN_BUFFER_BYTES,
  PRE_COMPACT_MIN_TURNS,
  HOOK_FILES,
};
