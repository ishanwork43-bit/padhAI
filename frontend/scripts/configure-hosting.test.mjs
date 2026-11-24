import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostingRules } from './configure-hosting.mjs';

test('hosting uses a non-forced SPA fallback without redirecting the Function API', () => {
  assert.equal(hostingRules(), '/*  /index.html  200\n');
});
