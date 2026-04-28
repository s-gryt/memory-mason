'use strict';

const firstNonEmptyString = (values) => {
  const stringValues = values.filter((value) => typeof value === 'string');
  const match = stringValues.find((value) => value.trim() !== '');
  return typeof match === 'string' ? match.trim() : '';
};

const extractPromptText = (platform, input) => {
  if (platform === 'copilot-vscode' || platform === 'claude-code' || platform === 'codex') {
    return firstNonEmptyString([input.prompt]);
  }

  if (platform === 'copilot-cli') {
    return firstNonEmptyString([input.prompt, input.userPrompt, input.initialPrompt]);
  }

  throw new Error('unsupported platform: ' + platform);
};

module.exports = {
  extractPromptText
};