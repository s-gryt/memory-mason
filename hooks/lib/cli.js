'use strict';

const formatErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const buildCommandErrorResult = (error) => ({
  status: 0,
  stdout: '',
  stderr: formatErrorMessage(error) + '\n'
});

const writeIfPresent = (text, writer) => {
  if (text !== '') {
    writer(text);
  }
};

module.exports = {
  formatErrorMessage,
  buildCommandErrorResult,
  writeIfPresent
};