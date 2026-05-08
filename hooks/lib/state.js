"use strict";

const path = require("node:path");
const { assertNonEmptyString, isObjectRecord, assertObjectRecord } = require("./assert");
const { loadJson, saveJson } = require("./json-state");
const {
  defaultCaptureMetrics,
  normalizeCaptureMetrics,
  accumulateCaptureMetrics,
} = require("./token-economics");
const { VAULT_META_DIR_NAME, VAULT_STATE_FILE_NAME } = require("./vault-paths");

const defaultState = () => ({
  ingested: {},
  last_compile: null,
  last_lint: null,
  capture_metrics: defaultCaptureMetrics(),
});

const resolveStatePath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, VAULT_META_DIR_NAME, VAULT_STATE_FILE_NAME);
};

const mergeWithDefaults = (state) => {
  if (!isObjectRecord(state)) {
    return defaultState();
  }

  const safeIngested = isObjectRecord(state.ingested) ? { ...state.ingested } : {};
  const safeCaptureMetrics = normalizeCaptureMetrics(state.capture_metrics);

  return {
    ...defaultState(),
    ...state,
    ingested: safeIngested,
    capture_metrics: safeCaptureMetrics,
  };
};

const updateStateCaptureMetrics = (state, source, capturedAt, rawContent, storedContent) => {
  const safeState = assertObjectRecord("state", state);
  const normalizedState = mergeWithDefaults(safeState);

  return {
    ...normalizedState,
    capture_metrics: accumulateCaptureMetrics(
      normalizedState.capture_metrics,
      source,
      capturedAt,
      rawContent,
      storedContent,
    ),
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

const recordCaptureMetrics = (
  vaultPath,
  subfolder,
  source,
  capturedAt,
  rawContent,
  storedContent,
) => {
  const updatedState = updateStateCaptureMetrics(
    loadState(vaultPath, subfolder),
    source,
    capturedAt,
    rawContent,
    storedContent,
  );

  saveState(vaultPath, subfolder, updatedState);
  return updatedState;
};

module.exports = {
  defaultState,
  resolveStatePath,
  loadState,
  saveState,
  updateStateCaptureMetrics,
  recordCaptureMetrics,
};
