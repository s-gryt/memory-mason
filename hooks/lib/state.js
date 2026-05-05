"use strict";

const path = require("node:path");
const { assertNonEmptyString, isObjectRecord, assertObjectRecord } = require("./assert");
const { loadJson, saveJson } = require("./json-state");

const defaultState = () => ({
  ingested: {},
  last_compile: null,
  last_lint: null,
});

const resolveStatePath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, "_meta", "state.json");
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
  const loadedState = loadJson(statePath, defaultState());
  return mergeWithDefaults(loadedState);
};

const saveState = (vaultPath, subfolder, state) => {
  const safeState = assertObjectRecord("state", state);
  const statePath = resolveStatePath(vaultPath, subfolder);
  saveJson(statePath, safeState);
};

module.exports = {
  defaultState,
  resolveStatePath,
  loadState,
  saveState,
};
