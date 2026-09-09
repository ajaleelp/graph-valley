# Talking on the platform: doubts, spoken answers, and getting back to the climb

**Date:** 2026-09-09
**Status:** design, not yet built

## What this is for

Two different things, which are worth separating because they have different
risks and different payoffs:

1. **Answering in your own words** instead of picking from four options.
   This is the bigger pedagogical win and the safer one to build.
2. **Asking a doubt** — a short conversation, on the platform, when something
   has not landed.

And one constraint that applies to both: she has to end up back on the path.
A tutor you can talk to forever is a chatbot with a map behind it, and the map
stops meaning anything.

## Why free-text answers matter more than they look

Recognition is the weakest form of retrieval. Picking "700 litres" from four
options can be done by elimination, by shape, by which one looks most like the
worked example. Producing the answer is a different act, and it is the one the
testing effect is actually about.

We are unusually well placed to grade it, for a reason that has nothing to do
with the model being clever: **every check already names the misconceptions its
distractors were built from.** So the judge's job is not open-ended grading —
which is squishy, and which CHALLENGES rightly calls out as not yet credible —
but **classification into a closed set we defined in advance**:

> Here is the atom. Here is what counts as holding it. Here are the three
> specific ways people get it wrong. Which of these does her answer show, or
> none of them?

Closed-set classification is markedly more reliable than "score this 1–5", and
it produces something the rest of the system already knows how to use: a
misconception id maps to an atom, an atom maps to a platform through
`remediationFor`, and a platform is a place. So a wrong spoken answer becomes a
walk back down to the practice that drilled it — the machinery is already
there, and this just gives it a better input than a mis-click.

### The verdict

```
{ verdict: "holds" | "partial" | "missed",
  misconception: "<the named one she showed, or null>",
  feedback: "one sentence, addressed to her, naming what is missing" }
```

- **holds** → correct, move on, same as a right click today.
- **partial** → accept it and supply the missing piece. Do not send her back;
  she has the idea and a correction is enough.
- **missed** → the existing remediation walk, and now we can say *why*.

Only `missed` costs her anything, which keeps a harsh judge from being
punishing.

## Asking a doubt

Bounded three ways, because the failure mode is obvious.

**A turn budget.** Three turns per platform, shown as dots the way the intake
shows them. Spent turns do not refill by leaving and coming back — otherwise
the budget is theatre.

**A scope rule.** The tutor knows this module's atoms, the ones she already
holds from earlier modules, and what this platform just showed her. It knows
nothing else, deliberately. When she asks about something from a later module
it does not teach it — it says where it lives:

> "That's the climb after this one — you'll meet it two platforms up."

This is the one place where the world earns its keep in a conversation, and it
is worth doing properly: **light that platform in the mist while the tutor says
it.** The answer to "why can't you tell me" becomes a thing she can see.

**A resolution signal.** The tutor decides when the doubt is answered and says
so, which ends the thread without spending the budget. Most doubts are one
turn; the budget is for the ones that are not.

### Getting back

Three levers, in order of gentleness:

1. The tutor closes it: *"That's the gap — try the question again."* The thread
   collapses and the check comes back into focus.
2. Budget runs low: the last turn is answered and the thread ends with the
   check restored. No cliff, no error message.
3. She leaves: closing the thread at any point returns to the check.

The conversation can never complete a platform. Only a check can. That single
rule is what stops the chat becoming the product.

## Where it attaches

| Stage | Spoken answer | Doubts |
|---|---|---|
| recall | no — it is a doorway | no |
| study | no — nothing has been asked yet | **yes**, this is where things fail to land |
| practice | **yes** — this is the completion problem | yes |
| prove | **yes** — free recall is the point | no; you do not get help in the examination |

`prove` is the one that changes most. Free recall against a known set of atoms
is a genuinely strong retrieval exercise, and it is exactly what the capstone
will need to be when it is finally administered.

## API

```
POST /api/answer   { topic, goal, id, stageId, checkIndex, text }
                -> { verdict, misconception, feedback, kc }

POST /api/ask      { topic, goal, id, stageId, turns[] }
                -> { reply, resolved, scope: "here"|"ahead"|"elsewhere",
                     pointsAt: "<stageId or moduleId>", turnsLeft }
```

`turns` is sent whole by the client, as the intake already does — the server
stays stateless and the transcript lives with the learner.

Both are classification-shaped, both return small JSON, and both treat the
learner's text as data. Her words go into the prompt as a quoted block that the
system prompt is told to evaluate, never to obey — the same posture as
`negotiate` takes with a topic.

## UI

- Under the lesson, one quiet line: **"Ask about this"** — expands into a
  thread with the budget shown as dots.
- On a check: a **"Answer in your own words"** toggle beside the options. The
  options stay. Some people want to click, and forcing prose on someone who
  just wants to get on with it is its own kind of friction.
- A `partial` verdict shows the correction inline and lets her continue. A
  `missed` verdict does what a wrong answer at `prove` already does — closes
  the sheet and walks her back down, now with a reason.

## What it costs

Every turn and every spoken answer is a model call, where an MCQ click is free.
Bounded per platform: at most three doubt turns and one judged answer per check.
The judge is a small call — an atom, a rubric, three misconceptions and her
sentence — so it should be cheap and fast; the doubt turns are the expensive
ones, which is another reason the budget is small.

Latency matters more here than anywhere else in the product. Waiting eight
seconds to find out whether your sentence was right is worse than clicking a
button, so this wants a smaller, faster model rather than the one that plans
courses.

## Risks

- **The chat eats the product.** Mitigated by the budget, the scope rule, and
  the hard constraint that only a check completes a platform. If it still
  happens, the budget goes to one.
- **A harsh judge is punishing.** Mitigated by `partial` being free. Worth
  watching in the trace: if `missed` fires more than a fifth of the time on
  answers that look reasonable, the rubric is wrong, not the learner.
- **It cannot tell a typo from a misconception.** Accept it. `partial` covers
  most of that gap.
- **Spoken answers make the fallback worse.** Judging against a fallback
  syllabus's atoms means judging against filler. The judge must refuse to run
  when the syllabus fell back, and leave the MCQ in place.

## Build order

1. `/api/answer` on `practice` only — smallest surface, best payoff, and it
   plugs into the remediation walk that already exists.
2. Extend it to `prove` as free recall.
3. `/api/ask` on `study`, with the budget and the scope rule.
4. The spatial half: lighting the platform an out-of-scope question points at.

Stage 1 is worth doing on its own even if the rest never gets built. Stages 3
and 4 are the ones that could go wrong, and they should not start until 1 has
been watched in a real trace.
