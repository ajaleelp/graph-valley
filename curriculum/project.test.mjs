import { test } from 'node:test';
import assert from 'node:assert/strict';

import { titleFor } from './project.mjs';

test('names the journey without the prompt template showing through', () => {
  // gpt-4o copies the schema's own phrasing into the statement, and that
  // string is the headline the learner sees.
  assert.equal(
    titleFor({ goal: { statement: 'she will be able to implement a basic algorithm from scratch' }, topic: 'ml' }),
    'Implement a basic algorithm from scratch',
  );
  assert.equal(
    titleFor({ goal: { statement: 'Explain why light cannot escape.' }, topic: 'x' }),
    'Explain why light cannot escape',
  );
  assert.equal(titleFor({ topic: 'sourdough' }), 'Sourdough');
});
