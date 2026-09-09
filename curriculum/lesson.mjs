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
- One concrete worked example — a real case, worked through, not an analogy
  standing in for one.
- Do NOT set her a task, and do not close by inviting her to attempt one. The
  next platform is where she tries it; posing an exercise here means she is
  asked two different questions in a row and cannot tell which she is
  answering.
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

/* Questions with no prose around them. `readLesson` insists on content — it is
 * reading a lesson — but recall and prove have none by design. */
export function readChecks(raw) {
  const offered = Array.isArray(raw?.checks) ? raw.checks : raw?.check ? [raw.check] : [];
  return offered.map(readCheck).filter(Boolean).slice(0, 6);
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
export function practicePrompt(doc, node, { atoms = [], needChecks = true } = {}) {
  const byKc = new Map((doc?.kcs || []).map((k) => [k.id, k]));
  const label = (id) => byKc.get(id)?.label || id;
  const ids = atoms.length ? atoms : node?.teaches || [];
  const scaffold = node?.segments?.find((s) => s.kind === 'apply')?.scaffold || 'partial';
  const support = {
    full: 'give almost the whole method, and leave her the last move',
    partial: 'give the setup and show the method starting, then stop',
    none: 'give the situation only; she works it unaided',
  }[scaffold] || 'give the setup and show the method starting, then stop';

  // What she is being drilled on decides what "practice" even means. An
  // "understand" atom is not practised by arithmetic: finishing a calculation
  // tests multiplication, and the platform claims to be teaching an idea.
  const LV = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
  const level = ids.map((id) => byKc.get(id)?.level).filter(Boolean)
    .reduce((a, b) => (LV.indexOf(b) > LV.indexOf(a) ? b : a), 'understand');
  const kind = LV.indexOf(level) <= 1
    ? `This is pitched at "${level}", so what she finishes is an EXPLANATION or a
judgement — why this happens, which case this is, what follows from it. Not a
calculation. Finishing a sum would test her arithmetic and tell neither of you
anything about the idea.`
    : `This is pitched at "${level}", so a worked procedure is the right shape —
she carries out the method, not merely describes it.`;

  return `Course: "${doc?.topic || ''}". She has just been shown a worked example of:
${ids.map((id) => `- ${label(id)}`).join('\n')}

${kind}

Now set her ONE problem on exactly those, and ${support}.

{"content": ["the situation, in one short paragraph",
             "the method starting, stopped before the part she must do"]${needChecks ? ',\n "checks": [ ... ]' : ''}}

Rules:
- Exactly 2 short paragraphs, at most 50 words each.
- Concrete: a real case, not "consider a scenario".
- Do NOT state the task as a question in the content. The QUESTION BELOW is the
  task. Writing it twice — once as prose and once as a check — leaves her
  reading two different questions and unsure which she is answering.
- Do NOT work out, anywhere in the content, the thing the question asks for.
  If the answer is sitting above the question, the question tests reading.
${needChecks ? `
Then TWO multiple-choice questions. The FIRST is the task itself — the part you
stopped before. The SECOND asks what the result MEANS, or why the method works.
{"checks": [{"question": "...", "options": ["a","b","c","d"],
             "answerIndex": 0, "explanation": "why that one is right"}]}
- Exactly four options each, one unambiguously correct.
- Never ask her to repeat a number that already appears in the content.
- At most ONE of the two may have a number for an answer, and only where the
  quantity is genuinely the point. Recalling a figure is not learning unless
  that figure is load-bearing — otherwise ask what it shows, what it rules out,
  or what would change it.
- Wrong options must be REASONING errors someone learning this actually makes,
  not arithmetic slips. "They confused the two directions" teaches something;
  "they multiplied by the wrong number" does not.
- Never "none of these"; never a restatement of another option.` : '- No quiz, no options — the check comes afterwards.'}`;
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


/* Questions with no lesson attached.
 *
 * `recall` and `prove` write no prose, but they still examine — and when the
 * syllabus behind them fell back, its "checks" are template filler ("the
 * accurate statement", "the words are interchangeable"). Filler is worse than
 * nothing in front of a learner, so ask for real questions instead. */
export function quizPrompt(doc, labels, stage) {
  const what = stage === 'recall'
    ? 'what she should already hold before going further'
    : 'everything this part of the course taught, retrieved cold';
  return `Course: "${doc?.topic || ''}". Goal: ${doc?.goal?.statement || ''}.

Write questions on ${what}:
${labels.map((l) => `- ${l}`).join('\n')}

{"content": [], "checks": [{"question": "...", "options": ["a","b","c","d"],
                            "answerIndex": 0, "explanation": "why that one is right"}]}

Rules:
- ${stage === 'prove' ? 'Three to five questions, one per idea above' : 'Two questions'}.
- Exactly four options each, one unambiguously correct.
- Ask about the substance of THIS course. Never about vocabulary in the
  abstract, never about the lesson itself, never "none of these".
- The wrong options must be mistakes someone learning this actually makes.`;
}
