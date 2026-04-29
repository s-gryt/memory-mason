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

const tryObsidianCli = (args, options) => {
  const spawnOptions = Object.assign({ encoding: 'utf-8', timeout: 8000 }, options);
  const result = require('child_process').spawnSync('obsidian', args, spawnOptions);
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