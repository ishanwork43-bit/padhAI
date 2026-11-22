import test from 'node:test';
import assert from 'node:assert/strict';
import { quizEvidence, resolveEvidence } from './evidence.mjs';
import { readFile } from 'node:fs/promises';
import { callGroq, providerPayload, validateInput, validateOutput } from './generation.mjs';

// Explicit provider fixtures: these tests never use credentials or network access.
const facts = [
  ['Mercury is the closest planet to the Sun.', 'Which planet is closest to the Sun?', 'Mercury'],
  ['Venus is the hottest planet.', 'Which planet has the highest temperature?', 'Venus'],
  ['Earth has one natural moon.', 'How many natural moons does Earth have?', 'one'],
  ['Mars has two small moons.', 'How many small moons orbit Mars?', 'two'],
  ['Jupiter is the largest planet.', 'Which planet is largest?', 'Jupiter'],
  ['Saturn is known for its prominent rings.', 'Which world is known for prominent rings?', 'Saturn'],
  ['Uranus rotates on its side.', 'Which planet rotates on its side?', 'Uranus'],
  ['Neptune is the farthest major planet from the Sun.', 'What is the most distant major planet?', 'Neptune'],
  ['The Sun is a star.', 'What kind of object is the Sun?', 'star'],
  ['Hydrogen is the most abundant element in the Sun.', 'Which element is most abundant in the Sun?', 'Hydrogen'],
  ['Gravity holds planets in orbit.', 'What holds planets in orbit?', 'Gravity'],
  ['An astronomical unit is the average distance from Earth to the Sun.', 'Which unit represents the average Earth to Sun distance?', 'astronomical unit'],
  ['A light-year measures distance.', 'What quantity does a light-year measure?', 'distance'],
  ['A comet is made largely of ice and dust.', 'What are comets largely made of?', 'ice and dust'],
  ['Asteroids are rocky objects.', 'How are asteroids described in these notes?', 'rocky objects'],
  ['The asteroid belt lies between Mars and Jupiter.', 'Where is the asteroid belt located?', 'between Mars and Jupiter'],
  ['The Milky Way is our galaxy.', 'What is the name of our galaxy?', 'Milky Way'],
  ['A nebula is a cloud of gas and dust.', 'What is a nebula?', 'cloud of gas and dust'],
  ['A supernova is a stellar explosion.', 'What event does the term supernova describe?', 'stellar explosion'],
  ['The Moon reflects sunlight.', 'What light does the Moon reflect?', 'sunlight'],
];
function fixture(count = 20) {
  const groups = Array.from({ length: 4 }, (_, i) => facts.slice(i * 5, i * 5 + 5));
  const sources = groups.map((group, i) => {
    const text = group.map(f => f[0]).join(' ');
    return { document_id: 'a'.repeat(64), filename: 'astronomy.pdf', page_number: i + 1, start_char: 0, end_char: text.length, text };
  });
  const input = validateInput({ task: 'quiz', request_id: crypto.randomUUID(), consent: true, sources, language: 'English', count, difficulty: 'easy' });
  const output = { status: 'supported', questions: facts.slice(0, count).map(([quote, question, answer], i) => ({
    question, options: [answer, 'Test distractor A', 'Test distractor B', 'Test distractor C'], correct_index: 0,
    explanation: quote, evidence_ids: [quizEvidence(input.sources).find(e => e.source_id === `S${Math.floor(i / 5) + 1}` && e.quote === quote).evidence_id],
  })) };
  return { input, output };
}

test('quiz schema uses evidence IDs and retains simple arrays with server-side count checks', () => {
  for (const count of [5, 10, 20]) {
    const { input } = fixture(count);
    const schema = providerPayload(input).response_format.json_schema.schema;
    assert.equal(schema.properties.questions.type, 'array');
    assert.equal(schema.properties.questions.items.additionalProperties, false);
    assert.equal(schema.properties.questions.anyOf, undefined);
    assert.equal(schema.properties.questions.items.properties.citations, undefined);
    assert.equal(schema.properties.questions.items.properties.evidence_ids.items.type, 'string');
    assert.match(providerPayload(input).messages[1].content, new RegExp(`exactly ${count} different`));
  }
});

test('one mocked Groq response yields 20 distinct MCQs with exact page-aware evidence', async () => {
  const { input, output } = fixture();
  let calls = 0;
  const result = await callGroq(input, { GROQ_API_KEY: 'test-only-unused-key' }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    const payload = JSON.parse(options.body);
    assert.equal(payload.response_format.json_schema.strict, true);
    assert.equal(payload.response_format.json_schema.schema.properties.questions.type, 'array');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
  });
  assert.equal(calls, 1);
  assert.equal(result.questions.length, 20);
  assert.equal(result.mode, 'generated');
  for (const [i, question] of result.questions.entries()) {
    assert.equal(question.options.length, 4);
    assert.equal(question.citations[0].page_number, Math.floor(i / 5) + 1);
    assert.equal(question.citations[0].quote, facts[i][0]);
  }
});

test('incomplete and oversized quizzes are rejected with safe counts; refusals remain valid', () => {
  const { input, output } = fixture();
  for (const count of [0, 19, 21]) {
    const questions = count === 21 ? [...output.questions, output.questions[0]] : output.questions.slice(0, count);
    assert.throws(() => validateOutput({ status: 'supported', questions }, input), e => e.code === 'invalid_generation' && e.message.includes(`returned ${count} questions; 20 were requested`));
  }
  assert.equal(validateOutput({ status: 'insufficient', questions: [] }, input).mode, 'insufficient');
  assert.throws(() => validateOutput({ ...output, status: 'insufficient' }, input));
});

test('20-question count cannot bypass duplicate, citation or correct-answer validation', () => {
  for (const mutate of [
    q => { q[19] = structuredClone(q[0]); },
    q => { q[19].evidence_ids = ['E999']; },
    q => { q[19].correct_index = 1; },
    q => { q[19].options[1] = q[19].options[0]; },
  ]) {
    const { input, output } = fixture(); mutate(output.questions);
    assert.throws(() => validateOutput(output, input), e => e.code === 'invalid_generation');
  }
});

test('a rejected mocked 20-question response consumes one call without automatic retries', async () => {
  const { input, output } = fixture(); output.questions.pop(); let calls = 0;
  await assert.rejects(callGroq(input, { GROQ_API_KEY: 'test-only-unused-key' }, async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
  }), e => e.code === 'invalid_generation');
  assert.equal(calls, 1);
});

for (const count of [5, 10]) {
  test(`complete ${count}-question mock resolves IDs into original citations without model-authored quotes`, async () => {
    const { input, output } = fixture(count);
    const result = await callGroq(input, { GROQ_API_KEY: 'test-only-unused-key' }, async (_url, request) => {
      const payload = JSON.parse(request.body), supplied = JSON.parse(payload.messages[1].content).source_data;
      assert.deepEqual(supplied, quizEvidence(input.sources).map(e => ({ evidence_id: e.evidence_id, text: e.quote })));
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
    });
    assert.equal(result.questions.length, count);
    for (const q of result.questions) {
      assert.equal(q.options.length, 4);
      for (const c of q.citations) {
        const source = input.sources.find(s => s.source_id === c.source_id);
        assert.equal(source.text.slice(c.start_char - source.start_char, c.end_char - source.start_char), c.quote);
        assert.equal(c.filename, source.filename);
        assert.equal(c.page_number, source.page_number);
      }
    }
    const partial = structuredClone(output); partial.questions.pop();
    assert.throws(() => validateOutput(partial, input), e => e.code === 'invalid_generation');
  });
}

for (const [label, original, rewritten, correct] of [
  ['PDF line break', 'Plants use\nchlorophyll to absorb sunlight.', 'Plants use chlorophyll to absorb sunlight.', 'chlorophyll'],
  ['repeated whitespace', 'Plants use  chlorophyll to absorb sunlight.', 'Plants use chlorophyll to absorb sunlight.', 'chlorophyll'],
  ['non-breaking whitespace', 'Plants use\u00a0chlorophyll to absorb sunlight.', 'Plants use chlorophyll to absorb sunlight.', 'chlorophyll'],
  ['PDF punctuation spacing', 'The Sun is a star .', 'The Sun is a star.', 'star'],
  ['typographic punctuation', 'Earth’s rotation causes day and night.', "Earth's rotation causes day and night.", 'rotation'],
]) {
  test(`${label}: rewritten quotes reproduce the mismatch, while IDs preserve original bytes and offsets`, () => {
    assert.equal(original.includes(rewritten), false);
    const { input, output } = fixture(5);
    input.sources[0].text = original;
    input.sources[0].start_char = 137;
    input.sources[0].end_char = 137 + original.length;
    // Keep four other, distinct questions on their original second page.
    const other = fixture(10).output.questions.slice(5, 9);
    const evidence = quizEvidence(input.sources), first = evidence.find(e => e.source_id === 'S1');
    const q = { question: 'Which concept is identified in the supplied passage?', options: [correct, 'Wrong choice A', 'Wrong choice B', 'Wrong choice C'], correct_index: 0, explanation: 'The selected evidence directly identifies this concept.', evidence_ids: [first.evidence_id] };
    for (const item of other) {
      const fact = facts.find(f => f[1] === item.question);
      item.evidence_ids = [evidence.find(e => e.quote === fact[0]).evidence_id];
    }
    output.questions = [q, ...other];
    const result = validateOutput(output, input);
    assert.equal(result.questions[0].citations[0].quote, original);
    assert.equal(result.questions[0].citations[0].start_char, 137);
    assert.equal(result.questions[0].citations[0].end_char, 137 + original.length);
  });
}

test('fabricated, repeated, empty and model-rewritten evidence references fail closed', () => {
  for (const mutate of [
    q => { q.evidence_ids = ['E999']; },
    q => { q.evidence_ids = []; },
    q => { q.evidence_ids = [q.evidence_ids[0], q.evidence_ids[0]]; },
    q => { q.evidence_ids = [q.evidence_ids[0], 'E999']; },
    q => { q.citations = [{ source_id: 'S1', quote: 'An invented quote.' }]; },
    q => { q.evidence_ids = [{ evidence_id: 'E1', quote: 'An invented quote.' }]; },
    q => { q.evidence_ids = ['E2']; }, // A real ID that does not support this correct answer.
    q => { q.options[0] = '---'; },
    q => { q.options[0] = 'Merc'; }, // Do not accept a fragment of another word.
    q => { q.options.pop(); },
  ]) {
    const { input, output } = fixture(5); mutate(output.questions[0]);
    assert.throws(() => validateOutput(output, input), e => e.code === 'invalid_generation');
  }
});

test('long and repeated excerpts preserve locations and stay within citation bounds', () => {
  const source = { ...fixture().input.sources[0], start_char: 91, text: '🪴 ' + 'a '.repeat(250) + 'ends here. Repeated evidence here. Repeated evidence here.' };
  const evidence = quizEvidence([source]);
  for (const e of evidence) {
    assert.ok(e.quote.length >= 10 && e.quote.length <= 350);
    assert.equal(source.text.slice(e.start_char - 91, e.end_char - 91), e.quote);
    assert.equal(e.quote.isWellFormed(), true);
  }
  const repeated = evidence.filter(e => e.quote === 'Repeated evidence here.');
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0].start_char, repeated[1].start_char);
  assert.equal(resolveEvidence([repeated[1].evidence_id], evidence)[0].start_char, repeated[1].start_char);
});

test('real PDF.js extraction resolves page-aware original text without whitespace repair', async () => {
  const { getDocument } = await import('../../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(await readFile(new URL('../../../frontend/public/samples/dbms_notes.pdf', import.meta.url))), useSystemFonts: true, disableFontFace: true });
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), content = await page.getTextContent();
      const raw = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('').replace(/\r\n?/g, '\n').trim();
      const source = { ...fixture().input.sources[0], page_number: n, text: raw.slice(0, 800).trimEnd(), start_char: 0 };
      const evidence = quizEvidence([source]); assert.ok(evidence.length);
      for (const e of evidence) {
        const [citation] = resolveEvidence([e.evidence_id], evidence);
        assert.equal(citation.page_number, n);
        assert.equal(raw.slice(citation.start_char, citation.end_char), citation.quote);
      }
      page.cleanup();
    }
  } finally { await task.destroy(); }
});

test('insufficient evidence returns no quiz; answer and summary citation formats remain compatible', async () => {
  const { input } = fixture(5);
  assert.equal(validateOutput({ status: 'insufficient', questions: [] }, input).mode, 'insufficient');
  const sparse = { ...input, sources: [{ ...input.sources[0], text: 'One. Two. Six.' }] };
  let calls = 0;
  const refusal = await callGroq(sparse, {}, async () => { calls++; throw new Error('Must not call provider'); });
  assert.equal(refusal.mode, 'insufficient'); assert.deepEqual(refusal.questions, []); assert.equal(calls, 0);
  for (const task of ['answer', 'summary']) {
    const compatible = { ...input, task, length: 'short', question: 'Which planet is closest to the Sun?' };
    const payload = providerPayload(compatible), schema = payload.response_format.json_schema.schema;
    assert.ok(schema.properties.claims.items.properties.citations);
    assert.equal(JSON.parse(payload.messages[1].content).source_data[0].source_id, 'S1');
    const result = validateOutput({ status: 'supported', claims: [{ text: 'Mercury is the closest planet to the Sun.', citations: [{ source_id: 'S1', quote: facts[0][0] }] }] }, compatible);
    assert.equal(result.claims[0].citations[0].quote, facts[0][0]);
  }
});
