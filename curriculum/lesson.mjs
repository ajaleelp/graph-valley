/* The lesson prompt, written from the syllabus rather than from a title.
 *
 * This is where the schema earns its keep. The old prompt knew a title and a
 * one-line summary; this one knows exactly which atom the platform teaches,
 * which atoms to pull back out of memory first, what people get wrong about
 * this particular idea, and where the whole thing is heading. Same endpoint,
 * same renderer — the difference is entirely in what the model is told.
 */

export const LESSON_SYSTEM =
  'You are a warm, precise teacher writing one short lesson. Output ONLY valid JSON. No markdown, no prose.';

const bullets = (items) => items.map((s) => `- ${s}`).join('\n');

/* Ask the model for its own questions.
 *
 * Normally the checks come from the syllabus, where each is tagged to an atom
 * and its distractors are drawn from named misconceptions — far better than
 * anything a lesson-writing call would invent. But when the syllabus itself
 * fell back, its "checks" are template filler ("the accurate statement", "the
 * words are interchangeable"), and filler shown to a learner is worse than a
 * question the model made up about what it just taught. */
const QUIZ_ASK = `
Then write TWO multiple-choice questions on what you just taught:
{"checks": [{"question": "...", "options": ["a","b","c","d"],
             "answerIndex": 0, "explanation": "why that one is right"}]}
- Exactly four options each, one unambiguously correct.
- The wrong ones must be plausible mistakes a learner would actually make —
  never "none of these", never a restatement of another option.
- Ask about the substance, not about vocabulary or about the lesson itself.`;

export function lessonPrompt(doc, node, fallback = {}, { needChecks = false } = {}) {
  if (!doc || !node) return plainPrompt(fallback, needChecks);

  const byKc = new Map(doc.kcs.map((k) => [k.id, k]));
  const label = (id) => byKc.get(id)?.label || id;

  const teaches = node.teaches.map(label);
  const recall = node.requires.map(label);
  const wrong = node.teaches.flatMap((id) => byKc.get(id)?.misconceptions || []);
  const scaffold = node.segments?.find((s) => s.kind === 'apply')?.scaffold || 'partial';

  const support = {
    full: 'walk the whole thing through for them — they have not done this unaided yet',
    partial: 'start it for them and let them finish',
    none: 'set it and step back; they should manage this unaided by now',
  }[scaffold] || 'start it for them and let them finish';

  return `Course: "${doc.topic}". Where it is heading: ${doc.goal?.statement}

This platform is "${node.title}". Teach exactly these, and nothing more:
${bullets(teaches)}

${recall.length ? `Open by pulling these back out of memory — they already have them, and
recalling them is what keeps them. Do not re-teach them:
${bullets(recall)}` : 'This is a starting point; assume nothing before it.'}

${wrong.length ? `People commonly get this wrong in these specific ways. Head them off,
without stating them so baldly that they stick:
${bullets(wrong)}` : ''}

Write the lesson as JSON:
{"content": ["paragraph 1", "paragraph 2", "paragraph 3"]${needChecks ? ', "checks": [ ... ]' : ''}}

Rules:
- Exactly 3 short paragraphs, aimed at ${doc.goal?.audience || 'a curious adult'}.
- At most 60 words each. This is read on a phone, on a platform in the sky —
  someone who wanted an essay would not be here.
- One concrete worked example with real numbers or a real case, not an analogy
  standing in for one.
- Close with a "now you try", with ${scaffold} support: ${support}.
- Plain language. No preamble, no "in this lesson we will".
${needChecks ? QUIZ_ASK : '- Do not write a quiz; the checks already exist.'}`;
}

/** When the platform cannot be located — an old client, or a stale title. */
function plainPrompt({ topic, title, summary }, needChecks = false) {
  return `Course: "${topic}". Current lesson: "${title}" — ${summary}.

Write the lesson as JSON:
{"content": ["paragraph 1", "paragraph 2", "paragraph 3"]${needChecks ? ', "checks": [ ... ]' : ''}}

Rules:
- Exactly 3 short paragraphs, at most 60 words each. Concrete, friendly, plain.
- Include one vivid worked example.
- Teach THIS lesson only; assume its prerequisites are already held.
${needChecks ? QUIZ_ASK : '- Do not write a quiz.'}`;
}

/* Read the model's reply.
 *
 * The prompt tells it not to write a quiz — the checks come from the syllabus,
 * where they are tagged to atoms and their distractors are named misconceptions.
 * So prose alone is the expected, correct reply, and demanding a check back
 * rejected every well-formed one. A volunteered check is kept only if it is
 * complete; a half-written one is worse than none.
 */
export function readLesson(raw) {
  if (!raw) return null;
  const content = Array.isArray(raw.content) ? raw.content.map(String).filter(Boolean).slice(0, 6) : [];
  if (!content.length) return null;

  // A model asked for questions answers with `checks`; one that volunteered a
  // single one answers with `check`. Take either, keep only the complete ones —
  // a half-written question is worse than none.
  const offered = Array.isArray(raw.checks) ? raw.checks : raw.check ? [raw.check] : [];
  const checks = offered.map(readCheck).filter(Boolean).slice(0, 4);

  if (!checks.length) return { content };
  return { content, checks, check: checks[0] };
}

function readCheck(c) {
  const options = Array.isArray(c?.options) ? c.options.map(String).slice(0, 4) : [];
  const answerIndex = Number(c?.answerIndex);
  const usable =
    typeof c?.question === 'string' &&
    options.length === 4 &&
    new Set(options).size === 4 &&
    Number.isInteger(answerIndex) &&
    answerIndex >= 0 &&
    answerIndex < 4;
  if (!usable) return null;
  return { question: c.question, options, answerIndex, explanation: String(c.explanation || '') };
}


/* --------------------------- the practice stage --------------------------
 * Faded practice, which is what `scaffold` has been asking for since the
 * schema was written and never once produced. The worked example is behind
 * her; this is the same idea with the middle taken out.
 *
 * Renkl and Sweller's completion effect: a problem with some steps given and
 * the rest left open teaches more per minute than either a worked example she
 * only reads or a blank problem she cannot start. */
export function practicePrompt(doc, node, { atoms = [] } = {}) {
  const byKc = new Map((doc?.kcs || []).map((k) => [k.id, k]));
  const label = (id) => byKc.get(id)?.label || id;
  const scaffold = node?.segments?.find((s) => s.kind === 'apply')?.scaffold || 'partial';
  const support = {
    full: 'give every step but the last, and let her supply only that',
    partial: 'give the setup and the first step or two; leave the rest',
    none: 'give the situation only; she works it unaided',
  }[scaffold] || 'give the setup and the first step or two; leave the rest';

  return `Course: "${doc?.topic || ''}". She has just worked through an example of:
${(atoms.length ? atoms : node?.teaches || []).map((id) => `- ${label(id)}`).join('\n')}

Now set her ONE problem on exactly those, and ${support}.

{"content": ["the situation, in one short paragraph",
             "the steps you are giving her, as a short worked opening",
             "what is left for her to finish, stated as a question"]}

Rules:
- Exactly 3 short paragraphs, at most 50 words each.
- Concrete: real numbers, a real case. Not "consider a scenario".
- Do NOT give the answer to the part you are leaving her.
- No quiz, no options — the check comes afterwards.`;
}

/* Recall and prove need no model call at all. Recall is a doorway: name what
 * she is about to need and ask her for it. Prove is the examination itself,
 * and inventing prose to wrap it would only pad the moment. */
export function stageLesson(stage, { atoms = [], labels = new Map(), goal } = {}) {
  const name = (id) => labels.get(id) || id;
  if (stage === 'recall') {
    return {
      content: [
        'Before anything new — pull these back out of memory. You have met them already; retrieving them now is what keeps them.',
        atoms.map(name).join(' · '),
      ],
    };
  }
  if (stage === 'prove') {
    return {
      content: [
        goal ? `Show you can: ${goal}` : 'Everything this place taught, without the notes.',
        'No worked example this time, and nothing to read first. If one of these will not come, you will be walked back to the platform that drilled it.',
      ],
    };
  }
  return null;
}
