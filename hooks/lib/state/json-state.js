/**
 * This module handles json state logic.
 */
"use strict";

const path = require("node:path");
const { UTF8_ENCODING } = require("../shared/constants");
const { assertSyncFsApi } = require("../shared/assert");

let tempFileCounter = 0;

const loadJson = (filePath, defaultValue, fsApi = require("node:fs")) => {
  if (!fsApi.existsSync(filePath)) {
    return defaultValue;
  }

  const rawJson = fsApi.readFileSync(filePath, UTF8_ENCODING);

  try {
    return JSON.parse(rawJson);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return defaultValue;
    }
    throw error;
  }
};

const saveJson = (filePath, data, fsApi = require("node:fs")) => {
  const safeFsApi = assertSyncFsApi(fsApi, ["mkdirSync", "writeFileSync", "renameSync"]);
  const dirPath = path.dirname(filePath);
  tempFileCounter += 1;
  const tempFilePath = path.join(
    dirPath,
    `${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${tempFileCounter}`,
  );

  safeFsApi.mkdirSync(dirPath, { recursive: true });
  safeFsApi.writeFileSync(tempFilePath, JSON.stringify(data, null, 2), UTF8_ENCODING);

  try {
    safeFsApi.renameSync(tempFilePath, filePath);
  } catch (renameError) {
    if (
      typeof safeFsApi.unlinkSync === "function" &&
      typeof safeFsApi.existsSync === "function" &&
      safeFsApi.existsSync(tempFilePath)
    ) {
      safeFsApi.unlinkSync(tempFilePath);
    }
    throw renameError;
  }
};

module.exports = {
  loadJson,
  saveJson,
};
