"use strict";

const os = require("node:os");
const { parseDotEnv, resolveVaultConfig } = require("../../lib/config/config");

const TEST_HOMEDIR = os.homedir();
const TEST_VAULT_PATH = "/tmp/test-vault";
const VALID_CONFIG_TEXT = JSON.stringify({ vaultPath: TEST_VAULT_PATH });

describe("parseDotEnv - equalsIndex <= 0 branch", () => {
  it("returns null (skips) for a line with no equals sign", () => {
    const result = parseDotEnv("NOEQUALSSIGN\nKEY=value");

    expect(result).toEqual({ KEY: "value" });
    expect(result.NOEQUALSSIGN).toBeUndefined();
  });

  it("returns null (skips) for a line starting with equals sign", () => {
    const result = parseDotEnv("=VALUE_WITH_NO_KEY\nKEY=value");

    expect(result).toEqual({ KEY: "value" });
  });

  it("returns null (skips) for a line that is only an equals sign", () => {
    const result = parseDotEnv("=\nKEY=value");

    expect(result).toEqual({ KEY: "value" });
  });
});

describe("resolveVaultConfigFromAlternatives - short-circuit when already resolved", () => {
  it("uses first resolved alternative and skips later ones", () => {
    const dotEnvText = `MEMORY_MASON_VAULT_PATH=${TEST_VAULT_PATH}`;
    const configText = JSON.stringify({ vaultPath: "/should-not-be-used" });

    const result = resolveVaultConfig(".", configText, TEST_HOMEDIR, { dotEnvText });

    expect(result.vaultPath).toBe(TEST_VAULT_PATH);
  });
});

describe("resolveVaultConfig - null config throw path", () => {
  it("throws when no config source provides a vault path", () => {
    expect(() => resolveVaultConfig("/some/cwd", "", TEST_HOMEDIR)).toThrow(
      "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });
});
