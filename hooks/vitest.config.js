'use strict';

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      all: true,
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: '../coverage',
      include: ['lib/*.js'],
      exclude: ['**/__tests__/**', 'vitest.config.js'],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100
      }
    }
  }
});