'use strict';

const { truncateContext } = require('./vault');

const assertNonEmptyString = (name, value) => {
  if (typeof value !== 'string' || value === '') {
    throw new Error(name + ' must be a non-empty string');
  }
  return value;
};

const assertPositiveInteger = (name, value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(name + ' must be a positive integer');
  }
  return value;
};

const extractTagText = (content, tagName) => {
  if (typeof content !== 'string' || typeof tagName !== 'string' || tagName === '') {
    return '';
  }

  const match = content.match(new RegExp('<' + tagName + '>([\\s\\S]*?)<\\/' + tagName + '>'));
  return Array.isArray(match) && typeof match[1] === 'string' ? match[1] : '';
};

const stripAnsiEscapeSequences = (content) => {
  if (typeof content !== 'string') {
    return '';
  }

  return content.replace(/\u001b\[[0-9;]*m/g, '');
};

const normalizeTranscriptText = (content) => {
  if (typeof content !== 'string') {
    return '';
  }

  const localCommandStdout = extractTagText(content, 'local-command-stdout');
  if (localCommandStdout !== '') {
    return stripAnsiEscapeSequences(localCommandStdout).trim();
  }

  const commandName = extractTagText(content, 'command-name').trim();
  if (commandName !== '') {
    const commandArgs = extractTagText(content, 'command-args').trim();
    return [commandName, commandArgs].filter((part) => part !== '').join(' ');
  }

  return content;
};

const extractEntryPayload = (entry) => {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    if (entry.message !== null && typeof entry.message === 'object' && !Array.isArray(entry.message)) {
      return {
        role: entry.message.role,
        content: entry.message.content
      };
    }

    return {
      role: entry.role,
      content: entry.content
    };
  }

  return {
    role: '',
    content: ''
  };
};

const extractTextContent = (rawContent) => {
  if (typeof rawContent === 'string') {
    return normalizeTranscriptText(rawContent);
  }

  if (Array.isArray(rawContent)) {
    return normalizeTranscriptText(
      rawContent
      .filter(
        (block) =>
          block !== null &&
          typeof block === 'object' &&
          !Array.isArray(block) &&
          block.type === 'text' &&
          typeof block.text === 'string'
      )
      .map((block) => block.text)
      .join('\n')
    );
  }

  return '';
};

const parseJsonlTranscript = (content) => {
  assertNonEmptyString('content', content);

  const lines = content.split('\n').filter((line) => line.trim() !== '');
  return lines.reduce((accumulator, line) => {
    try {
      const parsedEntry = JSON.parse(line);
      const payload = extractEntryPayload(parsedEntry);
      const role = payload.role;

      if (role !== 'user' && role !== 'assistant') {
        return accumulator;
      }

      const textContent = extractTextContent(payload.content);
      if (textContent.trim() === '') {
        return accumulator;
      }

      return accumulator.concat([
        {
          role,
          content: textContent
        }
      ]);
    } catch (error) {
      return accumulator;
    }
  }, []);
};

const selectRecentTurns = (turns, maxTurns) => {
  if (!Array.isArray(turns)) {
    throw new Error('turns must be an array');
  }

  assertPositiveInteger('maxTurns', maxTurns);

  if (turns.length <= maxTurns) {
    return turns.slice();
  }

  return turns.slice(turns.length - maxTurns);
};

const renderTurnsAsMarkdown = (turns) => {
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error('turns must be a non-empty array');
  }

  const markdownLines = turns.map((turn, index) => {
    if (turn === null || typeof turn !== 'object' || Array.isArray(turn)) {
      throw new Error('turn at index ' + index + ' must be an object');
    }

    if (turn.role !== 'user' && turn.role !== 'assistant') {
      throw new Error('turn at index ' + index + ' has invalid role');
    }

    if (typeof turn.content !== 'string' || turn.content === '') {
      throw new Error('turn at index ' + index + ' must have non-empty content');
    }

    const label = turn.role === 'user' ? 'User' : 'Assistant';
    return '**' + label + ':** ' + turn.content + '\n';
  });

  return markdownLines.join('\n');
};

const buildTranscriptExcerpt = (content, maxTurns, maxChars) => {
  assertPositiveInteger('maxTurns', maxTurns);
  assertPositiveInteger('maxChars', maxChars);

  const turns = parseJsonlTranscript(content);
  const recentTurns = selectRecentTurns(turns, maxTurns);

  if (recentTurns.length === 0) {
    return {
      markdown: '',
      turnCount: 0
    };
  }

  const markdown = renderTurnsAsMarkdown(recentTurns);
  const truncatedMarkdown = truncateContext(markdown, maxChars);

  return {
    markdown: truncatedMarkdown,
    turnCount: recentTurns.length
  };
};

module.exports = {
  extractTagText,
  stripAnsiEscapeSequences,
  normalizeTranscriptText,
  parseJsonlTranscript,
  selectRecentTurns,
  renderTurnsAsMarkdown,
  buildTranscriptExcerpt
};