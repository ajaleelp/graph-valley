/* The teaching loop, as geometry.
 *
 * A module's atoms are packed into groups of at most three by pack.mjs — that
 * is Sweller's cognitive load and it stays. What this adds is the thing that
 * happens AROUND a group, and the decision that each step of it is a place you
 * stand rather than a paragraph you scroll past.
 *
 *      prove          cold retrieval of everything the module taught
 *        |
 *   practice_i        the same atoms, faded: she finishes what was started
 *        |
 *    study_i          the worked example — atoms introduced, ≤3 at a time
 *        |
 *     recall          what the module needs from earlier, pulled back first
 *
 * The order is Gagné's events of instruction and Merrill's first principles,
 * and every step of it is already in the schema: `segments` names activate /
 * demonstrate / apply, and `scaffold` says how much support to leave. Until now
 * they were prompt hints that produced three undifferentiated paragraphs. Here
 * they become four kinds of platform.
 *
 * Two consequences worth stating.
 *
 * Where a module has several study/practice pairs they are laid out in rows of
 * at most two, each row waiting on the one below. So the level forks — a real
 * choice of which to take first — without fanning into five parallel columns
 * that read as five separate beginnings rather than one climb. Two is a choice;
 * five is a menu.
 *
 * And failure has somewhere to go. Getting a prove check wrong does not mean
 * guessing again; it means walking back DOWN to the practice platform that
 * taught the atom you missed. That is the up-and-down, and it is remediation
 * rather than movement for its own sake.
 */

const LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
const rank = (l) => Math.max(0, LEVELS.indexOf(l));

export const STAGES = ['recall', 'study', 'practice', 'prove'];

/* How many study/practice pairs may sit side by side. Two is a choice you can
 * see from where you are standing; five is a menu, and it makes a level read as
 * several unconnected beginnings rather than one climb. */
export const FORK_WIDTH = 2;

/* A stage platform is still a platform: the renderer, the nav graph and the
 * unlock rules all read the same {id, title, summary, deps, goal} it always
 * did. What it gains is `stage`, which decides what happens when she arrives —
 * and, once the renderer reads it, what the place looks like. */
export function toStages(doc) {
  const byKc = new Map((doc.kcs || []).map((k) => [k.id, k]));
  const groups = doc.nodes || [];
  const out = [];

  const label = (id) => byKc.get(id)?.label || id;
  const allTaught = groups.flatMap((n) => n.teaches || []);

  // What this module leans on from earlier ones: required by something here,
  // taught by nothing here.
  const inside = new Set(allTaught);
  const priors = [...new Set(groups.flatMap((n) => n.requires || []))].filter((k) => !inside.has(k));

  // 1. Recall. Only if there is genuinely something to pull back — the first
  //    module of a course has nothing behind it, and an empty warm-up platform
  //    is exactly the filler this design is trying to remove.
  let entry = [];
  if (priors.length) {
    out.push({
      id: 's-recall',
      stage: 'recall',
      title: 'What you already have',
      summary: `Before anything new: ${priors.slice(0, 3).map(label).join(', ')}.`,
      goal: false,
      objective: { verb: 'recall', level: 'remember' },
      teaches: [],
      recalls: priors,
      requires: [],
      checks: priors.map((k) => byKc.get(k)?.check).filter(Boolean).slice(0, 2),
      deps: [],
    });
    entry = ['s-recall'];
  }

  // 2 & 3. Study then practice, one pair per group of atoms, in rows of at
  //        most FORK_WIDTH. Within a row the pairs are independent — that is
  //        the fork; each row waits on the row below it — that is the climb.
  const pairEnds = [];
  let row = [];
  let below = entry;
  const usable = groups.filter((n) => (n.teaches || []).length);
  usable.forEach((n, i) => {
    const teaches = n.teaches;
    const lvl = LEVELS[Math.max(...teaches.map((k) => rank(byKc.get(k)?.level)))] || 'understand';
    const studyId = `s-study-${i + 1}`;
    const practiceId = `s-practice-${i + 1}`;

    out.push({
      id: studyId,
      stage: 'study',
      title: n.title,
      summary: n.summary || `Worked through: ${teaches.map(label).join(', ')}.`,
      goal: false,
      objective: { verb: 'study', level: lvl },
      teaches,
      requires: n.requires || [],
      // Studying is not where she is examined. One check, to catch a
      // misreading before she is asked to use it.
      checks: (n.checks || []).slice(0, 1),
      deps: below,
    });

    out.push({
      id: practiceId,
      stage: 'practice',
      title: `${n.title} — your turn`,
      summary: `Finish what the example started.`,
      goal: false,
      objective: { verb: 'apply', level: lvl },
      teaches: [],
      exercises: teaches,
      requires: teaches,
      // Everything the pair introduced, examined at the level it claims.
      checks: n.checks || [],
      deps: [studyId],
    });
    row.push(practiceId);
    // Close the row: the next pair starts from what this row finished.
    if (row.length === FORK_WIDTH || i === usable.length - 1) {
      below = row;
      pairEnds.length = 0;
      pairEnds.push(...row);
      row = [];
    }
  });

  // 4. Prove. Cold retrieval across the whole module, after the last practice —
  //    which is the first point at which the atoms have been out of sight long
  //    enough for retrieving them to be worth anything.
  if (pairEnds.length) {
    out.push({
      id: 's-prove',
      stage: 'prove',
      title: 'Prove it',
      summary: doc.goal?.statement
        ? `Show you can: ${doc.goal.statement}`
        : 'Everything this place taught, without the notes.',
      goal: true,
      objective: { verb: 'prove', level: doc.goal?.level || 'apply' },
      teaches: [],
      retrieves: allTaught,
      requires: allTaught,
      checks: allTaught.map((k) => byKc.get(k)?.check).filter(Boolean),
      deps: pairEnds,
    });
  }

  return out;
}

/* Which platform to send her back to when she misses a check on `prove`.
 *
 * The syllabus knows which atom each check belongs to, so a wrong answer names
 * the atom she has not got — and the practice platform for that atom is a
 * place, which means the remediation is a walk rather than a message. */
export function remediationFor(stages, kcId) {
  const practice = stages.find((s) => s.stage === 'practice' && (s.exercises || []).includes(kcId));
  if (practice) return practice.id;
  const study = stages.find((s) => s.stage === 'study' && (s.teaches || []).includes(kcId));
  return study ? study.id : null;
}

/* The renderer's shape, from stages rather than from the syllabus directly. */
export function stagesToGraph(stages, title) {
  return {
    title,
    nodes: stages.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      deps: s.deps,
      goal: !!s.goal,
      stage: s.stage,
      level: s.objective?.level || 'understand',
      atoms: (s.teaches || []).length || (s.exercises || []).length || (s.retrieves || []).length,
    })),
  };
}
