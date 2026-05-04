"use strict";

const CAPTURE_MODE_LITE = "lite";
const CAPTURE_MODE_FULL = "full";
const HOOK_EVENT_STOP = "stop";
const DUPLICATE_CAPTURE_WINDOW_MS = 60000;

const USER_INPUT_TOOLS = new Set(["AskUserQuestion"]);

const NOISY_TOOLS = new Set(["Read", "Glob", "LS", "List", "ls", "read", "glob"]);

module.exports = {
  CAPTURE_MODE_LITE,
  CAPTURE_MODE_FULL,
  HOOK_EVENT_STOP,
  DUPLICATE_CAPTURE_WINDOW_MS,
  USER_INPUT_TOOLS,
  NOISY_TOOLS,
};
