/**
 * This module handles writer logic.
 */
"use strict";

const WINDOWS_CMD = "cmd.exe";
const WIN_CMD_FLAG_D = "/d";
const WIN_CMD_FLAG_S = "/s";
const WIN_CMD_FLAG_C = "/c";
const OBSIDIAN_BIN = "obsidian";

const fs = require("node:fs");
const { buildDailyFolderPath, buildDailyFilePath } = require("./vault");
const { OBSIDIAN_CLI_TIMEOUT_MS } = require("./constants");
const { appendToChunked } = require("./chunk-writer");
const { UTF8_ENCODING } = require("../shared/constants");
const { PLATFORM_WIN32 } = require("../config/platforms");
const { assertNonEmptyString, assertString } = require("../shared/assert");

const resolveObsidianCommand = (args, platform) =>
  platform === PLATFORM_WIN32
    ? {
        command: WINDOWS_CMD,
        args: [WIN_CMD_FLAG_D, WIN_CMD_FLAG_S, WIN_CMD_FLAG_C, OBSIDIAN_BIN].concat(args),
        options: { windowsHide: true },
      }
    : {
        command: OBSIDIAN_BIN,
        args,
        options: {},
      };

const OBSIDIAN_CLI_FAILURE_PREFIX = "[memory-mason] obsidian CLI unavailable";

let obsidianCliFailureWarned = false;

const tryObsidianCli = (args, options) => {
  const safeOptions = options !== null && typeof options === "object" ? options : {};
  const {
    platform = process.platform,
    spawnSync = require("node:child_process").spawnSync,
    ...spawnOptions
  } = safeOptions;
  const command = resolveObsidianCommand(args, platform);
  const result = spawnSync(
    command.command,
    command.args,
    Object.assign(
      { encoding: UTF8_ENCODING, timeout: OBSIDIAN_CLI_TIMEOUT_MS },
      command.options,
      spawnOptions,
    ),
  );
  const succeeded = result.status === 0 && result.error == null;
  if (!succeeded && !obsidianCliFailureWarned) {
    obsidianCliFailureWarned = true;
    const reason = result.error != null ? result.error.message : `exit status ${result.status}`;
    process.stderr.write(
      `${OBSIDIAN_CLI_FAILURE_PREFIX} (${reason}), falling back to direct file writes\n`,
    );
  }
  return succeeded;
};

const appendToDaily = (vaultPath, subfolder, today, content, options = {}) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeToday = assertNonEmptyString("today", today);
  const safeContent = assertString("content", content);

  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("options must be an object");
  }

  const folderPath = buildDailyFolderPath(safeVaultPath, safeSubfolder, safeToday);
  const flatPath = buildDailyFilePath(safeVaultPath, safeSubfolder, safeToday);

  if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
    appendToChunked(safeVaultPath, safeSubfolder, safeToday, safeContent, options);
    return;
  }

  if (fs.existsSync(flatPath)) {
    fs.appendFileSync(flatPath, safeContent, UTF8_ENCODING);
    return;
  }

  appendToChunked(safeVaultPath, safeSubfolder, safeToday, safeContent, options);
};

module.exports = {
  tryObsidianCli,
  appendToDaily,
};
