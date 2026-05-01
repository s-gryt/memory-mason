"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertNonEmptyString } = require("./config");

const isObjectRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertObjectRecord = (name, value) => {
  if (!isObjectRecord(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
};

const defaultState = () => ({
  ingested: {},
  last_compile: null,
  last_lint: null,
});

const resolveStatePath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, "state.json");
};

const mergeWithDefaults = (state) => {
  if (!isObjectRecord(state)) {
    return defaultState();
  }

  const safeIngested = isObjectRecord(state.ingested) ? { ...state.ingested } : {};
  return {
    ...defaultState(),
    ...state,
    ingested: safeIngested,
  };
};

const loadState = (vaultPath, subfolder) => {
  const statePath = resolveStatePath(vaultPath, subfolder);

  if (!fs.existsSync(statePath)) {
    return defaultState();
  }

  const rawState = fs.readFileSync(statePath, "utf-8");

  try {
    const parsedState = JSON.parse(rawState);
    return mergeWithDefaults(parsedState);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return defaultState();
    }
    throw error;
  }
};

const saveState = (vaultPath, subfolder, state) => {
  const safeState = assertObjectRecord("state", state);
  const statePath = resolveStatePath(vaultPath, subfolder);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(safeState, null, 2), "utf-8");
};

module.exports = {
  defaultState,
  resolveStatePath,
  loadState,
  saveState,
};
