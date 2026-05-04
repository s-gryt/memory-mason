"use strict";

const path = require("node:path");

const loadJson = (filePath, defaultValue, fsApi = require("node:fs")) => {
  if (!fsApi.existsSync(filePath)) {
    return defaultValue;
  }

  const rawJson = fsApi.readFileSync(filePath, "utf-8");

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
  fsApi.mkdirSync(path.dirname(filePath), { recursive: true });
  fsApi.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
};

module.exports = {
  loadJson,
  saveJson,
};
