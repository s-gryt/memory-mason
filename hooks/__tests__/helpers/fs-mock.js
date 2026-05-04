"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createTempVaultFixture = (prefix) => {
  let tempDirectories = [];

  const trackTempDirectory = (directoryPath) => {
    tempDirectories = tempDirectories.concat([directoryPath]);
    return directoryPath;
  };

  const createTempVaultPath = () =>
    trackTempDirectory(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

  const cleanupTempVaultPaths = () => {
    tempDirectories.forEach((directoryPath) => {
      if (fs.existsSync(directoryPath)) {
        fs.rmSync(directoryPath, { recursive: true, force: true });
      }
    });
    tempDirectories = [];
  };

  return {
    createTempVaultPath,
    cleanupTempVaultPaths,
  };
};

module.exports = {
  createTempVaultFixture,
};
