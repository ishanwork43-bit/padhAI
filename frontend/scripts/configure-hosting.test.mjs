import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyRules } from './configure-hosting.mjs';
test('proxy precedes SPA fallback and preserves API paths', () =>
  assert.equal(
    proxyRules('https://study-api.onrender.com/'),
    '/api/*  https://study-api.onrender.com/api/:splat  200!\n/*  /index.html  200\n',
  ));
for (const value of [
  undefined,
  '',
  'http://api.example',
  'https://user:secret@api.example',
  'https://api.example/path',
  'https://api.example?secret=key',
  'https://api.example/#fragment',
  'https://localhost',
  'https://api.example\n/* /bad 301',
])
  test(`rejects unsafe backend configuration ${String(value).replace(/secret/g, 'redacted')}`, () =>
    assert.throws(() => proxyRules(value)));
