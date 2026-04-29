'use strict';

const fs = require('fs');
const path = require('path');
const { buildDailyFilePath, buildDailyHeader } = require('./vault');
const { assertNonEmptyString } = require('./config');

const assertString = (name, value) => {
  if (typeof value !== 'string') {
    throw new Error(name + ' must be a string');
  }
  return value;
};

const resolveObsidianCommand = (args, platform) =>
  platform === 'win32'
    ? {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', 'obsidian'].concat(args),
        options: { windowsHide: true }
      }
    : {
        command: 'obsidian',
        args,
        options: {}
      };

const tryObsidianCli = (args, options) => {
  const safeOptions = options !== null && typeof options === 'object' ? options : {};
  const { platform = process.platform, spawnSync = require('child_process').spawnSync, ...spawnOptions } = safeOptions;
  const command = resolveObsidianCommand(args, platform);
  const result = spawnSync(
    command.command,
    command.args,
    Object.assign({ encoding: 'utf-8', timeout: 8000 }, command.options, spawnOptions)
  );
  return result.status === 0 && result.error == null;
};

const appendToDaily = (vaultPath, subfolder, today, content) => {
  const safeVaultPath = assertNonEmptyString('vaultPath', vaultPath);
  const safeSubfolder = assertNonEmptyString('subfolder', subfolder);
  const safeToday = assertNonEmptyString('today', today);
  const safeContent = assertString('content', content);
  const dailyPath = buildDailyFilePath(safeVaultPath, safeSubfolder, safeToday);

  fs.mkdirSync(path.dirname(dailyPath), { recursive: true });

  if (!fs.existsSync(dailyPath)) {
    fs.writeFileSync(dailyPath, buildDailyHeader(safeToday), 'utf-8');
  }

  fs.appendFileSync(dailyPath, safeContent, 'utf-8');
};

module.exports = {
  tryObsidianCli,
  appendToDaily
};