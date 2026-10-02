# How we change this code (SOP)

For people and AI agents alike. The map of the code is [ARCHITECTURE.md](ARCHITECTURE.md): read it before you change anything.

## 1. Before you write code

1. **Find the place in the map** (ARCHITECTURE §2, §5, §6). If the thing has no place, decide one *before* writing, and add it to the map in the same change.
2. **Search first.** Before you write a helper, look for one (`grep` the function you need). Two copies of the same logic is the main thing this SOP exists to stop.
3. **Feature code goes in the feature's folder**, not spread over `dialogs/`, `sidebar/`, `runtime/`. A Logic node type lives in `src/features/logic/<family>/`, and only there.

## 2. Code rules

| Rule | Why |
| --- | --- |
| No new `if (node.type === …)` chains for things that have many kinds: register them (Logic nodes: `defineLogicNodes` / `defineLogicEditors` / `defineLogicRuntimes`). | Adding a kind must not mean editing five files. `test/logic-registry.test.js` enforces it for Logic nodes. |
| One file, one reason to change. Aim for under 400 lines; split before going past ~600. | A file you can read in one sitting. |
| Pure logic in `src/model/` (or a pure module next to the feature), DOM / sockets / workers in the shell. | The core is testable in plain Node. |
| A function gets what it needs as arguments or a `ctx`, rather than reaching for globals. | Fewer hidden couplings and import cycles. |
| Thread / network messages: a wire format in `src/shared/<name>/`, one file shared by both sides. | No encoder and decoder drifting apart. |
| `const` / `let` in new and touched code, not `var`. | |
| Comments say **why**, in one or two lines. No history ("this replaced…", "the reported bug was…"): that is what git is for. Don't comment the obvious. | Long narrative comments are noise and go stale. |
| Names say what a thing is: `linkRequest`, `logicOutputCount`, not `handle2` / `doStuff`. | |
| `dist/` is generated: never edit it. | |

## 3. Adding a feature (checklist)

1. Place it (ARCHITECTURE §6).
2. Write the pure part and its test first, if it has one.
3. Write the shell part (editor / page / server).
4. Tests:
   - a unit test for the new module;
   - add the file to `test/run-all.js`;
   - an end-to-end test if it crosses the editor, the page, or the server (see §5).
5. Document it:
   - the feature's `docs/*.md`;
   - ARCHITECTURE (map / where-to-look) if a place or a flow changed;
   - `.agents/NEXA_DASHBOARD_PROGRESS.md`.

## 4. Fixing a bug (checklist)

1. Use ARCHITECTURE §5 to find the start point.
2. Reproduce it in a test (unit, or e2e for timing / live-page bugs), then fix it.
3. If the fix shows a structure problem (a duplicate, a misplaced function), fix the bug now. Add the structure issue to ARCHITECTURE §7 instead of refactoring in the same commit.

## 5. Definition of done

- `node test/run-all.js` ends with `RESULT: ALL PASSED`.
- The e2e test that covers the area passes:
  - tags, bindings, IO: `node test/tags-e2e.test.js` in `nexa-component-ui-library` (99 checks);
  - Nexa Link, workers, IO plumbing: `node test/link-e2e.test.js`;
  - shared variables across pages: `node test/shared-vars-e2e.test.js`;
  - editor UI: an isolated Node-RED e2e with a screenshot you have looked at (`.agents/skills/nexa-testing-and-verification`).
- Docs updated (§3.5).
- Never test against the real `data/` userDir. Use an isolated Node-RED on 1899 / 1898 (link 1897).

## 6. Refactoring

- **Small steps, each one green.** Move one thing, run the tests, commit. No big-bang rewrite.
- **A refactor commit changes structure, not behaviour.** Keep odd behaviour as is, write it down (ARCHITECTURE §7), and change it in its own commit after a decision.
- **Refactor and feature work in separate commits.**
- **Move with `git mv`**, so history follows the file.

## 7. Commits and branches

- Messages: `type(scope): what`, for example `feat(link): …`, `fix(runtime): …`, `refactor(logic): …`, `test: …`, `docs: …`.
- Author: the developer (`kufayeka`). No AI co-author lines.
- Push only to the `kufayeka/*` repositories, and only when asked.

## 8. For AI agents

- Read ARCHITECTURE.md and this file before changing code. Follow them over your own habits.
- Put new code where the map says. If the map has no place for it, ask or propose one. Don't invent a new folder quietly.
- Don't copy a function to change it slightly: extend or parametrise the existing one.
- Report what you ran and what failed, with the output. If a step was skipped, say so.
