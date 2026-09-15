/* The one thing the renderer still needs from a course document that is not
 * geometry: what to call the journey.
 *
 * This file used to also hold `toGraph`, which flattened a whole syllabus to
 * the `{ id, title, summary, deps, goal }` shape the old renderer read. That
 * shape now comes from `stages.mjs`, one module at a time, and nothing called
 * the projection any more. */

/* The journey's headline.
 *
 * The negotiate schema shows the goal as "she will be able to ...", and models
 * copy that phrasing straight into the statement — which then reads back to the
 * learner as the name of their own journey. Strip the scaffolding and the
 * trailing full stop; fall back to the topic when there is no goal at all.
 */
export function titleFor(doc) {
  const raw = String(doc.goal?.statement || '').trim();
  if (!raw) {
    const t = String(doc.topic || 'A journey').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const stripped = raw
    .replace(/^(?:the learner|she|he|they|you)\s+(?:will|should|can)\s+be able to\s+/i, '')
    .replace(/^(?:will|should|can)\s+be able to\s+/i, '')
    .replace(/\s*\.\s*$/, '')
    .trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
