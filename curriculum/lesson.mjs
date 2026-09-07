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

export function lessonPrompt(doc, node, fallback = {}) {
  if (!doc || !node) return plainPrompt(fallback);

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
{"content": ["paragraph 1", "paragraph 2", "paragraph 3"]}

Rules:
- 2 to 4 short paragraphs, aimed at ${doc.goal?.audience || 'a curious adult'}.
- Include one concrete worked example with real numbers or a real case — not an
  analogy standing in for one.
- Then a "now you try", with ${scaffold} support: ${support}.
- Plain language. No preamble, no "in this lesson we will".
- Do not write a quiz; the checks already exist.`;
}

/** When the platform cannot be located — an old client, or a stale title. */
function plainPrompt({ topic, title, summary }) {
  return `Course: "${topic}". Current lesson: "${title}" — ${summary}.

Write the lesson as JSON:
{"content": ["paragraph 1", "paragraph 2", "paragraph 3"]}

Rules:
- 2 to 4 short paragraphs. Concrete, friendly, plain language.
- Include one vivid worked example.
- Teach THIS lesson only; assume its prerequisites are already held.
- Do not write a quiz.`;
}
