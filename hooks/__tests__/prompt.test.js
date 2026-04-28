'use strict';

const { extractHookEventName, buildPromptExpansionText, extractPromptText, extractPromptEntry } = require('../lib/prompt');

describe('prompt helpers', () => {
  it('extracts hook event name from known fields', () => {
    expect(extractHookEventName({ hook_event_name: 'UserPromptExpansion' })).toBe('UserPromptExpansion');
    expect(extractHookEventName({ hookEventName: 'user-prompt-submit' })).toBe('user-prompt-submit');
  });

  it('returns empty event name for invalid input', () => {
    expect(extractHookEventName(null)).toBe('');
    expect(extractHookEventName('not-an-object')).toBe('');
  });

  it('builds rich prompt expansion text', () => {
    expect(
      buildPromptExpansionText({
        prompt: '/caveman explain',
        expansion_type: 'slash_command',
        command_name: 'caveman:caveman',
        command_args: 'explain',
        command_source: 'plugin'
      })
    ).toBe('/caveman explain\ntype: slash_command\ncommand: caveman:caveman\nargs: explain\nsource: plugin');
  });

  it('omits empty optional prompt expansion fields', () => {
    expect(
      buildPromptExpansionText({
        prompt: '/model',
        expansion_type: '',
        command_name: '',
        command_args: '',
        command_source: ''
      })
    ).toBe('/model');
  });

  it('returns prompt expansion entry for Claude UserPromptExpansion', () => {
    expect(
      extractPromptEntry('claude-code', {
        hook_event_name: 'UserPromptExpansion',
        prompt: '/caveman explain',
        command_name: 'caveman:caveman'
      })
    ).toEqual({
      entryName: 'UserPromptExpansion',
      text: '/caveman explain\ncommand: caveman:caveman'
    });
  });
});

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

  it('returns user prompt entry for non-expansion events', () => {
    expect(extractPromptEntry('claude-code', { hook_event_name: 'UserPromptSubmit', prompt: '/mml' })).toEqual({
      entryName: 'UserPrompt',
      text: '/mml'
    });
  });
});