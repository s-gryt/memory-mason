/** This module handles coaching advisory emission logic. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildDailyFolderPath } = require("../vault/vault");
const { VAULT_META_DIR_NAME } = require("../vault/vault-paths");
const { UTF8_ENCODING } = require("../shared/constants");
const {
  assertNonEmptyString,
  assertObjectRecord,
  assertPositiveInteger,
  isObjectRecord,
} = require("../shared/assert");
const { CHUNK_ID_WIDTH } = require("../vault/constants");

const MAX_COACHING_META_COUNT = 999;
const COACHING_META_WRITE_FLAG = "wx";

const buildCoachingMetaDirPath = (vaultPath, subfolder, dateIso) =>
  path.join(buildDailyFolderPath(vaultPath, subfolder, dateIso), VAULT_META_DIR_NAME);

const buildCoachingFrontmatter = (payload) => {
  assertObjectRecord("payload", payload);
  assertNonEmptyString("payload.kind", payload.kind);
  assertNonEmptyString("payload.hash", payload.hash);
  assertPositiveInteger("payload.count", payload.count);
  assertNonEmptyString("payload.sessionId", payload.sessionId);
  assertNonEmptyString("payload.iso", payload.iso);

  const snippetLine =
    typeof payload.snippet === "string" && payload.snippet !== ""
      ? `snippet: ${JSON.stringify(payload.snippet)}\n`
      : "";

  return `---\nkind: ${payload.kind}\nhash: ${payload.hash}\ncount: ${payload.count}\nsessionId: ${payload.sessionId}\niso: ${payload.iso}\n${snippetLine}---\n\n`;
};

const nextCoachingMetaOrdinal = (metaDirPath, fsApi = fs) => {
  let entries;

  try {
    entries = fsApi.readdirSync(metaDirPath);
  } catch (_error) {
    return 1;
  }

  const ordinalPattern = /^\d{3}\.md$/;
  const ordinals = entries
    .filter((name) => ordinalPattern.test(name))
    .map((name) => parseInt(name.slice(0, CHUNK_ID_WIDTH), 10));

  if (ordinals.length === 0) {
    return 1;
  }

  const max = Math.max(...ordinals);

  if (max >= MAX_COACHING_META_COUNT) {
    throw new Error("coaching meta count exceeds 999");
  }

  return max + 1;
};

const writeCoachingMetaFile = (filePath, content, fsApi) => {
  try {
    fsApi.writeFileSync(filePath, content, {
      encoding: UTF8_ENCODING,
      flag: COACHING_META_WRITE_FLAG,
    });
    return true;
  } catch (error) {
    if (error && error.code === "EEXIST") {
      return false;
    }

    throw error;
  }
};

const COACHING_EMIT_FAILURE_PREFIX = "[memory-mason] coaching advisory write failed";

const emitCoachingAdvisory = (vaultPath, subfolder, dateIso, payload, fsApi = fs) => {
  assertNonEmptyString("vaultPath", vaultPath);
  assertNonEmptyString("subfolder", subfolder);
  assertNonEmptyString("dateIso", dateIso);
  assertObjectRecord("payload", payload);

  const content = buildCoachingFrontmatter(payload);

  try {
    const metaDirPath = buildCoachingMetaDirPath(vaultPath, subfolder, dateIso);

    fsApi.mkdirSync(metaDirPath, { recursive: true });

    let ordinal = nextCoachingMetaOrdinal(metaDirPath, fsApi);

    while (ordinal <= MAX_COACHING_META_COUNT) {
      const fileName = `${String(ordinal).padStart(CHUNK_ID_WIDTH, "0")}.md`;
      const filePath = path.join(metaDirPath, fileName);

      if (writeCoachingMetaFile(filePath, content, fsApi)) {
        return { filePath, ordinal };
      }

      ordinal += 1;
    }

    throw new Error("coaching meta count exceeds 999");
  } catch (error) {
    process.stderr.write(`${COACHING_EMIT_FAILURE_PREFIX}: ${error.message}\n`);
    return null;
  }
};

const emitRepeatedCoachingNag = (options) => {
  const { state, hash, sessionId, resolvedConfig, dateIso, advisory, shouldEmitNag, markNagged } =
    options;

  if (!shouldEmitNag(state, hash, sessionId)) {
    return state;
  }

  const entry = state.coachingState.promptHashCounts[hash];
  if (!isObjectRecord(entry)) {
    return state;
  }

  const emitted = emitCoachingAdvisory(
    resolvedConfig.vaultPath,
    resolvedConfig.subfolder,
    dateIso,
    {
      ...advisory,
      hash,
      count: entry.count,
      sessionId,
      snippet: entry.snippet,
    },
  );
  if (emitted === null) {
    return state;
  }
  return markNagged(state, hash, sessionId);
};

const emitRepeatedPlanCoachingNag = (options) => {
  const { state, hash, plan, resolvedConfig, kind, shouldEmitNag, markNagged } = options;

  return emitRepeatedCoachingNag({
    state,
    hash,
    sessionId: plan.sessionId,
    resolvedConfig,
    dateIso: plan.today,
    advisory: { kind, iso: plan.iso },
    shouldEmitNag,
    markNagged,
  });
};

module.exports = {
  buildCoachingMetaDirPath,
  buildCoachingFrontmatter,
  nextCoachingMetaOrdinal,
  emitCoachingAdvisory,
  emitRepeatedCoachingNag,
  emitRepeatedPlanCoachingNag,
};
