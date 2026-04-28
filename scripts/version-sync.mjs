import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const trackedFiles = [
  {
    path: '.claude-plugin/plugin.json',
    fields: [['version']],
  },
  {
    path: 'gemini-extension.json',
    fields: [['version']],
  },
  {
    path: 'plugins/memory-mason/.codex-plugin/plugin.json',
    fields: [['version']],
  },
  {
    path: 'hooks/package.json',
    fields: [['version']],
  },
  {
    path: 'hooks/package-lock.json',
    fields: [['version'], ['packages', '', 'version']],
  },
];

function readVersion() {
  const version = readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`VERSION must contain semver-like value, got "${version}"`);
  }

  return version;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  writeFileSync(path.join(repoRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function getField(container, fieldPath) {
  return fieldPath.reduce((value, segment) => value?.[segment], container);
}

function setField(container, fieldPath, nextValue) {
  const parent = fieldPath.slice(0, -1).reduce((value, segment) => value?.[segment], container);

  if (parent === undefined || parent === null) {
    throw new Error(`Missing field path ${fieldPath.join('.')} in tracked manifest`);
  }

  parent[fieldPath[fieldPath.length - 1]] = nextValue;
}

function collectMismatches(expectedVersion) {
  return trackedFiles.flatMap((trackedFile) => {
    const json = readJson(trackedFile.path);

    return trackedFile.fields.flatMap((fieldPath) => {
      const actualVersion = getField(json, fieldPath);

      if (actualVersion === expectedVersion) {
        return [];
      }

      return [{
        filePath: trackedFile.path,
        fieldPath: fieldPath.join('.'),
        actualVersion,
        expectedVersion,
      }];
    });
  });
}

function syncVersions(expectedVersion) {
  for (const trackedFile of trackedFiles) {
    const json = readJson(trackedFile.path);

    for (const fieldPath of trackedFile.fields) {
      setField(json, fieldPath, expectedVersion);
    }

    writeJson(trackedFile.path, json);
  }
}

function printMismatches(mismatches) {
  for (const mismatch of mismatches) {
    console.error(
      `${mismatch.filePath} :: ${mismatch.fieldPath} = ${JSON.stringify(mismatch.actualVersion)} (expected ${JSON.stringify(mismatch.expectedVersion)})`,
    );
  }
}

function main() {
  const mode = process.argv[2] ?? 'check';
  const expectedVersion = readVersion();

  if (mode === 'sync') {
    syncVersions(expectedVersion);
    console.log(`Synced tracked manifest versions to ${expectedVersion}`);
    return;
  }

  if (mode !== 'check') {
    throw new Error(`Unknown mode "${mode}". Use "check" or "sync".`);
  }

  const mismatches = collectMismatches(expectedVersion);

  if (mismatches.length > 0) {
    console.error(`Version drift detected against VERSION=${expectedVersion}`);
    printMismatches(mismatches);
    process.exitCode = 1;
    return;
  }

  console.log(`All tracked manifest versions match VERSION=${expectedVersion}`);
}

main();