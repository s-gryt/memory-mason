"use strict";

const fs = require("node:fs");
const path = require("node:path");
const hooksRoot = path.resolve(__dirname, "..", "..");

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

const materializeProjectDotEnvConfig = (cwd, env, generatedEnvPaths = []) => {
  const vaultPath =
    typeof env.MEMORY_MASON_VAULT_PATH === "string" ? env.MEMORY_MASON_VAULT_PATH : "";
  if (vaultPath === "") {
    return;
  }

  if (path.resolve(cwd) === hooksRoot) {
    throw new Error("Test config helper must not write .env inside hooks root.");
  }

  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath) && !generatedEnvPaths.includes(envPath)) {
    return;
  }

  const subfolder =
    typeof env.MEMORY_MASON_SUBFOLDER === "string" ? env.MEMORY_MASON_SUBFOLDER : "";
  const lines = [`MEMORY_MASON_VAULT_PATH=${vaultPath}`];
  if (subfolder !== "") {
    lines.push(`MEMORY_MASON_SUBFOLDER=${subfolder}`);
  }

  writeText(envPath, `${lines.join("\n")}\n`);
  if (!generatedEnvPaths.includes(envPath)) {
    generatedEnvPaths.push(envPath);
  }
};

module.exports = {
  materializeProjectDotEnvConfig,
};
