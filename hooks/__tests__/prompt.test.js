'use strict';

const { extractPromptText } = require('../lib/prompt');

describe('extractPromptText', () => {
  it('reads prompt for copilot vscode', () => {
    expect(extractPromptText('copilot-vscode', { prompt: '  /mmc  ' })).toBe('/mmc');
  });

  it('reads prompt for claude code', () => {
    expect(extractPromptText('claude-code', { prompt: '/mml' })).toBe('/mml');
  });

  it('reads prompt for codex', () => {
    expect(extractPromptText('codex', { prompt: '$mmq hooks' })).toBe('$mmq hooks');
  });

  it('falls back across known copilot cli prompt fields', () => {
    expect(extractPromptText('copilot-cli', { initialPrompt: '/mms' })).toBe('/mms');
    expect(extractPromptText('copilot-cli', { userPrompt: '/mmq writer' })).toBe('/mmq writer');
  });

  it('returns empty string when prompt missing', () => {
    expect(extractPromptText('copilot-vscode', {})).toBe('');
  });

  it('throws for unsupported platform', () => {
    expect(() => extractPromptText('unknown', { prompt: '/mmc' })).toThrow('unsupported platform: unknown');
  });
});