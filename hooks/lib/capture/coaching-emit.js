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
} = require("../shared/assert");
const { CHUNK_ID_WIDTH } = require("../vault/constants");

const MAX_COACHING_META_COUNT = 999;

const buildCoachingMetaDirPath = (vaultPath, subfolder, dateIso) =>
  path.join(buildDailyFolderPath(vaultPath, subfolder, dateIso), VAULT_META_DIR_NAME);

const buildCoachingFrontmatter = (payload) => {
  assertObjectRecord("payload", payload);
  assertNonEmptyString("payload.kind", payload.kind);
  assertNonEmptyString("payload.hash", payload.hash);
  assertPositiveInteger("payload.count", payload.count);
  assertNonEmptyString("payload.sessionId", payload.sessionId);
  assertNonEmptyString("payload.iso", payload.iso);

  return `---\nkind: ${payload.kind}\nhash: ${payload.hash}\ncount: ${payload.count}\nsessionId: ${payload.sessionId}\niso: ${payload.iso}\n---\n\n`;
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

const emitCoachingAdvisory = (vaultPath, subfolder, dateIso, payload, fsApi = fs) => {
  assertNonEmptyString("vaultPath", vaultPath);
  assertNonEmptyString("subfolder", subfolder);
  assertNonEmptyString("dateIso", dateIso);
  assertObjectRecord("payload", payload);

  const metaDirPath = buildCoachingMetaDirPath(vaultPath, subfolder, dateIso);

  fsApi.mkdirSync(metaDirPath, { recursive: true });

  const ordinal = nextCoachingMetaOrdinal(metaDirPath, fsApi);
  const fileName = `${String(ordinal).padStart(CHUNK_ID_WIDTH, "0")}.md`;
  const filePath = path.join(metaDirPath, fileName);
  const content = buildCoachingFrontmatter(payload);

  fsApi.writeFileSync(filePath, content, UTF8_ENCODING);

  return { filePath, ordinal };
};

module.exports = {
  buildCoachingMetaDirPath,
  buildCoachingFrontmatter,
  nextCoachingMetaOrdinal,
  emitCoachingAdvisory,
};
