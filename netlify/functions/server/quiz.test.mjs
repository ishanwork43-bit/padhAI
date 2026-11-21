import test from 'node:test';
import assert from 'node:assert/strict';
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
    explanation: quote, citations: [{ source_id: `S${Math.floor(i / 5) + 1}`, quote }],
  })) };
  return { input, output };
}

test('5/10/20-question provider schemas allow only the requested count or empty evidence refusal', () => {
  for (const count of [5, 10, 20]) {
    const { input } = fixture(count);
    const schema = providerPayload(input).response_format.json_schema.schema;
    const [complete, insufficient] = schema.properties.questions.anyOf;
    assert.equal(complete.minItems, count);
    assert.equal(complete.maxItems, count);
    assert.equal(insufficient.maxItems, 0);
    assert.equal(complete.items.$ref, '#/$defs/question');
    assert.equal(schema.$defs.question.additionalProperties, false);
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
    assert.equal(payload.response_format.json_schema.schema.properties.questions.anyOf[0].minItems, 20);
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
    q => { q[19].citations[0].quote = 'An invented quote that is not in the notes.'; },
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
