'use strict';

const { spawnSync } = require('child_process');
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
  const result = spawnSync('obsidian', args, spawnOptions);
  return result.status === 0 && result.error == null;
};

const readFileIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf-8');
};

const appendToDaily = (vaultPath, subfolder, today, content) => {
  const safeVaultPath = assertNonEmptyString('vaultPath', vaultPath);
  const safeSubfolder = assertNonEmptyString('subfolder', subfolder);
  const safeToday = assertNonEmptyString('today', today);
  const safeContent = assertString('content', content);
  const dailyPath = buildDailyFilePath(safeVaultPath, safeSubfolder, safeToday);
  const dailyPathFromVaultRoot = safeSubfolder + '/daily/' + safeToday + '.md';
  const dailyFileExists = fs.existsSync(dailyPath);
  const beforeContent = readFileIfExists(dailyPath);
  const vaultName = path.basename(safeVaultPath);
  const cliArgs = dailyFileExists
    ? ['append', 'path=' + dailyPathFromVaultRoot, 'content=' + safeContent]
    : ['create', 'path=' + dailyPathFromVaultRoot, 'content=' + buildDailyHeader(safeToday) + safeContent];
  const cliWriteSucceeded = tryObsidianCli(['vault=' + vaultName].concat(cliArgs), { cwd: safeVaultPath });
  const afterContent = readFileIfExists(dailyPath);

  if (cliWriteSucceeded) {
    if (beforeContent === null && afterContent !== null && afterContent.includes(safeContent)) {
      return;
    }

    if (beforeContent !== null && afterContent !== null && afterContent !== beforeContent && afterContent.includes(safeContent)) {
      return;
    }
  }

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