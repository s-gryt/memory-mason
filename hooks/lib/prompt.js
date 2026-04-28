'use strict';

const firstNonEmptyString = (values) => {
  const stringValues = values.filter((value) => typeof value === 'string');
  const match = stringValues.find((value) => value.trim() !== '');
  return typeof match === 'string' ? match.trim() : '';
};

const extractHookEventName = (input) =>
  firstNonEmptyString([
    input !== null && typeof input === 'object' && !Array.isArray(input) ? input.hook_event_name : '',
    input !== null && typeof input === 'object' && !Array.isArray(input) ? input.hookEventName : ''
  ]);

const buildPromptExpansionText = (input) => {
  const prompt = firstNonEmptyString([input.prompt]);
  const expansionType = firstNonEmptyString([input.expansion_type, input.expansionType]);
  const commandName = firstNonEmptyString([input.command_name, input.commandName]);
  const commandArgs = firstNonEmptyString([input.command_args, input.commandArgs]);
  const commandSource = firstNonEmptyString([input.command_source, input.commandSource]);

  return [
    prompt,
    expansionType === '' ? '' : 'type: ' + expansionType,
    commandName === '' ? '' : 'command: ' + commandName,
    commandArgs === '' ? '' : 'args: ' + commandArgs,
    commandSource === '' ? '' : 'source: ' + commandSource
  ]
    .filter((value) => value !== '')
    .join('\n');
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

const extractPromptEntry = (platform, input) => {
  if (platform === 'claude-code' && extractHookEventName(input) === 'UserPromptExpansion') {
    return {
      entryName: 'UserPromptExpansion',
      text: buildPromptExpansionText(input)
    };
  }

  return {
    entryName: 'UserPrompt',
    text: extractPromptText(platform, input)
  };
};

module.exports = {
  extractHookEventName,
  buildPromptExpansionText,
  extractPromptText,
  extractPromptEntry
};