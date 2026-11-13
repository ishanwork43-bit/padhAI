import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appUrl, render, build } from './build.mjs';

test('missing URL produces an honest pending state without a broken launch link', () => {
  const page = render('{{APP_CTA}} {{APP_STATUS}} {{APP_CTA}}', '');
  assert.match(page, /Study app launching soon/);
  assert.doesNotMatch(page, /href=|\{\{/);
  assert.match(page, /being set up/);
});

test('valid Streamlit origin produces a usable HTTPS link', () => {
  assert.equal(appUrl('https://padhai-demo.streamlit.app'), 'https://padhai-demo.streamlit.app/');
  assert.match(render('{{APP_CTA}}', 'https://padhai-demo.streamlit.app'), /rel="noopener noreferrer"/);
});

for (const invalid of [
  'javascript:alert(1)', 'http://padhai.streamlit.app',
  'https://padhai.streamlit.app.evil.example', 'https://evil.example',
  'https://user:secret@padhai.streamlit.app', 'https://padhai.streamlit.app:8080',
  'https://padhai.streamlit.app/?token=secret', 'https://padhai.streamlit.app/#notes',
  'https://padhai.streamlit.app/path', 'https://padhai.streamlit.app/\n',
  'https://bad%22name.streamlit.app', 'https://-bad.streamlit.app',
  'https://streamlit.app', 'https://nested.bad.streamlit.app',
]) {
  test(`reject unsafe or unsupported app URL: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => appUrl(invalid));
  });
}

test('build includes only landing assets and intentional public samples', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'padhai-web-'));
  try {
    const out = join(temp, 'dist');
    await build('', out);
    assert.deepEqual((await readdir(out)).sort(), ['404.html', 'favicon.svg', 'index.html', 'samples', 'styles.css']);
    assert.deepEqual((await readdir(join(out, 'samples'))).sort(), ['cloud_computing.txt', 'dbms_notes.md', 'dbms_notes.pdf']);
    const pending = await readFile(join(out, 'index.html'), 'utf8');
    assert.doesNotMatch(pending, /\{\{|https:\/\/YOUR/);
    await assert.rejects(() => build('javascript:alert(1)', out));
    assert.equal(await readFile(join(out, 'index.html'), 'utf8'), pending);
    await build('https://padhai-demo.streamlit.app', out);
    assert.match(await readFile(join(out, 'index.html'), 'utf8'), /https:\/\/padhai-demo.streamlit.app\//);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
