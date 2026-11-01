# AGENTS.md — LexiQuest

## Purpose

This file defines mandatory working rules for AI coding agents working on LexiQuest.

LexiQuest is a local-first Vue 3 + TypeScript learning application for children. Its core content model is:

```text
Library package
└── Adventure
    └── Quest
        └── dynamically generated Challenges
            └── questions generated from vocabulary, child skill, progress, settings, and available resources
```

The repository specifications and accepted ADRs are the authority. Do not silently replace documented product decisions with implementation shortcuts.

---

## 1. Mandatory reading before implementation

Before changing runtime behavior, persistence, library handling, Challenge generation, progress, routing, rewards, settings, or child-facing UX:

1. Read `architecture/CURRENT_IMPLEMENTATION.md`.
2. Read the relevant canonical specification under `architecture/`, `content/`, or `ai-spec/`.
3. Read applicable accepted ADRs in `architecture/ADR/`.
4. Check whether the requested behavior is already implemented before creating a parallel implementation.
5. If implementation and documentation disagree, stop treating the outdated text as authoritative and reconcile the documentation as part of the same coherent change.

For AI-assisted implementation, use these as primary guidance:

```text
ai-spec/AI_IMPLEMENTATION.md
ai-spec/AI_TECHNICAL_SPEC.md
architecture/CURRENT_IMPLEMENTATION.md
architecture/CHILD_SKILL_LEVEL_AND_DYNAMIC_CHALLENGE_ENGINE_SPEC.md
architecture/APP_SETTINGS_SPEC.md
architecture/DATA_MODEL.md
content/ADVENTURE_LIBRARY_FORMAT.md
```

Do not create version-suffixed replacement specifications such as `SPEC-v2.md`, `SPEC-new.md`, or `SPEC-final.md` unless explicitly requested. Update canonical documents in place.

---

## 2. Git workflow — mandatory

### 2.1 One coherent change = one commit

Every coherent, independently understandable change must be committed immediately after it is complete.

A coherent change may include:

- implementation code,
- tests for that implementation,
- migrations required by that implementation,
- documentation updates required to describe that implementation.

Do not accumulate unrelated work into one large commit.

Do not leave completed coherent changes uncommitted while starting the next feature.

Examples of good commit boundaries:

```text
feat: derive quest challenge count from vocabulary
test: cover adaptive final quest review
fix: exclude locked vocabulary from generated review
docs: document quest challenge generation policy
refactor: centralize challenge generation settings
```

When code, tests, and documentation are inseparable parts of one behavior change, they may and usually should be committed together.

### 2.2 Inspect before committing

Before every commit:

```bash
git status
git diff
git diff --staged
```

Verify that:

- only intended files are included,
- generated build/version artifacts are not accidentally committed,
- no unrelated user changes are overwritten,
- no secrets, local paths, credentials, tokens, or machine-specific files are added.

Never discard or overwrite unrelated working-tree changes merely to obtain a clean diff.

### 2.3 Pre-commit verification

Before committing a coherent change, run the narrowest relevant checks first.

Examples:

```bash
npm run test -- <relevant-test>
npm run test
npm run lint
```

Use focused tests during development. Run broader checks when the change crosses multiple subsystems.

Do not use a successful build as a substitute for tests that should exist.

### 2.4 Commit first, build second

A full build is a **post-commit action**.

After every commit, run:

```bash
npm run build
```

This is mandatory even when focused tests and lint already passed.

`npm run build` currently performs version preparation before lint and type checking, so it is the authoritative post-commit integration check.

### 2.5 If the post-commit build fails

Do not amend the already completed commit merely to hide the failure.

Instead:

1. inspect the failure,
2. implement the necessary fix,
3. run relevant focused checks,
4. create a new coherent fix commit,
5. run `npm run build` again.

Continue until the latest commit has a successful post-commit build.

Document any failure that cannot be resolved without changing requirements.

### 2.6 Never commit generated version files

Generated version artifacts such as:

```text
gitversion.json
src/generated/version.ts
```

must remain uncommitted when they are configured as generated/ignored files.

---

## 3. Core architecture rules

### 3.1 Local first

LexiQuest is local-first.

Child data, progress, weak-word state, rewards, streaks, settings, and library state must respect the existing local persistence architecture.

Do not introduce a remote dependency for behavior that is currently local unless explicitly approved by a specification/ADR.

### 3.2 Vue 3 + TypeScript

Follow the existing Vue 3 and TypeScript architecture.

Do not:

- introduce `any` to bypass typing,
- duplicate domain models inside components,
- place durable product policy in UI components,
- mutate props,
- use `v-html` for untrusted/library content,
- bypass services/stores to write persistence directly from arbitrary components.

Prefer:

- typed domain interfaces,
- pure services for policy and generation logic,
- centralized settings defaults,
- deterministic functions that are easy to test.

### 3.3 Dexie / IndexedDB

Dexie is the persistence layer.

Any persisted schema change must:

1. have an explicit migration,
2. preserve existing user progress whenever possible,
3. have tests for old → new migration behavior,
4. avoid deleting user state unless the product decision explicitly requires it.

Never assume a fresh database.

---

## 4. Product terminology

Use these terms consistently:

| Term | Meaning |
|---|---|
| Library package | Portable declarative learning-content package |
| Adventure | Learner-facing course/map; format v1 maps one package to one Adventure |
| Quest | One learning unit/node within an Adventure |
| Challenge | One playable exercise block within a Quest |
| Task | Internal implementation term only where existing code uses it |
| Vocabulary item / Sense | Language-independent concept |
| Term | Language-specific accepted expression for a vocabulary item |
| Weak word | Previously introduced vocabulary currently requiring additional practice |

Do not expose `Task` as child-facing terminology when the UI concept is `Challenge`.

Do not use Library, Adventure, Quest, and Challenge interchangeably.

---

## 5. Library architecture

### 5.1 Libraries are resource-only declarative content

A library may contain:

```text
manifest.yaml
adventure.yaml
quests/
dictionary/
images/
audio/
README.md
LICENSE.md
```

A library may define:

- metadata,
- one Adventure in format v1,
- Quest organization,
- ordered vocabulary references,
- language-independent vocabulary concepts,
- accepted translations/terms,
- images,
- audio,
- tags,
- attribution and licenses.

A library must not contain executable application logic.

### 5.2 Libraries do not define mandatory runtime Challenge types

Do not add fixed runtime test sequences to libraries.

The engine chooses question formats dynamically from:

```text
child skill level
app settings
available resources
language direction
progress
weak-word state
```

Legacy Challenge/test-type fields may be imported only as non-binding migration hints.

### 5.3 Missing resources must fail soft

Examples:

- no image → do not select image-required modes,
- no bundled audio + TTS available → TTS may be used,
- no audio and no fallback → skip audio-required mode,
- unusable item → exclude it from that generated attempt,
- missing media must never freeze the app.

Library validation must cover:

- schema version,
- IDs,
- references,
- path safety,
- supported languages,
- media types and limits,
- duplicate IDs,
- sufficient usable vocabulary,
- prohibition of executable content.

---

## 6. Quest and Challenge generation

### 6.1 Challenges are generated from Quest vocabulary

Quest content defines ordered vocabulary. Runtime Challenge count is derived from that vocabulary.

Default:

```text
maxNewVocabularyPerChallenge = 3
learningChallengeCount = ceil(questVocabularyCount / maxNewVocabularyPerChallenge)
```

Then append one final Quest review Challenge.

For 8 vocabulary items:

```text
Challenge 1: new 1–3
Challenge 2: new 4–6 + review 1–3
Challenge 3: new 7–8 + review 1–6
Challenge 4: final review 1–8
```

### 6.2 New vocabulary rule

Each learning Challenge:

- introduces exactly 3 new vocabulary items when at least 3 remain,
- introduces 1–2 only when fewer remain,
- never introduces more than the configured maximum,
- never uses future/locked vocabulary as review material.

### 6.3 Cumulative adaptive review

A learning Challenge may review vocabulary introduced by previous Challenges in the same Quest.

Review priority:

1. wrong / active weak words,
2. lowest successful exposure count,
3. least recently seen,
4. remaining introduced vocabulary.

Do not choose review words uniformly at random when progress data is available.

The same seed + same progress snapshot should produce deterministic selection where deterministic generation is expected by tests.

### 6.4 Learning Challenge question budget

Defaults:

```yaml
maxNewVocabularyPerChallenge: 3
questionsPerNewVocabulary: 2
reviewQuestionRatio: 0.35
minQuestions: 6
```

Each newly introduced usable vocabulary item should receive at least 2 main-phase exposures when valid modes are available.

Repeated exposures should use a different valid question mode when possible.

Avoid immediate repetition of the same vocabulary item when alternatives exist.

Question count is a target, not a reason to generate invalid questions. Resource and pedagogical validity take precedence.

### 6.5 Final Quest Challenge

Every Quest ends with one `final-review` Challenge.

It:

- introduces no new vocabulary,
- includes all usable Quest vocabulary,
- guarantees at least 1 main-phase question for every usable vocabulary item,
- targets 2 questions per item,
- gives extra capacity first to weak and low-exposure vocabulary,
- prefers a different question mode or language direction for repeated exposure,
- uses the standard wrong-answer review loop after the main phase.

Defaults:

```yaml
guaranteeQuestionsPerVocabulary: 1
targetQuestionsPerVocabulary: 2
maxQuestions: 30
```

Conceptually:

```text
guaranteedQuestions = usableQuestVocabularyCount
targetQuestions = usableQuestVocabularyCount * 2
finalQuestionCount = min(targetQuestions, 30)
```

If the cap prevents 2 questions per item:

1. first cover every usable item once,
2. allocate remaining capacity by review priority.

Large Quests should normally be split during content design rather than solved by excessively long final Challenges.

### 6.6 Progress and unlocking

- learning Challenges unlock sequentially,
- completing a learning Challenge marks its new vocabulary as introduced,
- final review unlocks only after all learning Challenges are complete,
- replaying a completed Challenge introduces no new vocabulary,
- replay regenerates questions from the same eligible vocabulary scope using current progress,
- interrupted attempts do not mark the entire new vocabulary set as introduced unless a future explicit product decision changes persistence granularity.

### 6.7 Edge cases

Handle explicitly:

```text
0 vocabulary items  → invalid Quest; not playable
1–2 vocabulary      → 1 learning Challenge + 1 final review
missing media       → choose valid fallback mode or skip unusable item
duplicate Quest IDs → validation error / deterministic normalization per canonical validator
```

Never borrow locked vocabulary just to reach a target question count.

---

## 7. Question generation principles

Question generation must be driven by capability and learning value, not by a fixed list stored in content.

Use:

- child skill level,
- app settings,
- language direction,
- available resources,
- exposure history,
- errors,
- weak-word status.

For repeated exposure to the same item, prefer variation such as:

```text
image → English term
audio → image
Czech term → English term
English term → Czech meaning
sentence / phrase mode when valid for the child's level
```

Do not force a mode that lacks required resources.

Do not create ambiguous multiple-choice distractors for beginners.

For early readers, prefer semantically distinct distractors. Near-synonyms or subtly different sentences belong to more advanced proficiency levels.

---

## 8. Skill levels and child-specific behavior

Child skill level is parent-managed runtime policy.

Do not encode a child's current skill restrictions inside library files.

The same library should remain usable across supported skill levels when its resources allow it.

Question policy must be resolved centrally, not independently by components.

When adding a mode:

1. define its capability requirements,
2. define allowed skill levels,
3. define resource requirements,
4. define supported language directions,
5. add policy tests,
6. add generation tests,
7. update settings/specification documentation.

---

## 9. Wrong answers, weak words, and review

A wrong main-phase answer must update weak-word state immediately.

Correcting the word later during review does not erase the fact that it was weak during the attempt.

Main-phase score becomes locked before review.

Review:

- improves practice/exposure state,
- can participate in answer streak behavior where specified,
- does not retroactively improve the locked main score.

Do not merge scoring and remediation into one mutable result.

---

## 10. Settings ownership

Runtime product behavior belongs in typed application settings, not component constants.

Examples:

- max new words per Challenge,
- question budgets,
- review ratios,
- final review cap,
- pass threshold,
- streak rules,
- reward rules,
- accessibility behavior,
- resource fallback behavior.

Before adding a constant to a component/service, check whether it is product policy. If yes, add it to the canonical settings contract.

---

## 11. Testing requirements

Every behavior change must include tests at the lowest useful level.

Prefer:

### Pure service tests

For:

- Challenge scope generation,
- question budgets,
- review priority,
- mode eligibility,
- resource filtering,
- deterministic selection,
- weak-word updates,
- streak and reward logic.

### Migration tests

For:

- Dexie version upgrades,
- profile model changes,
- progress schema changes.

### Component tests

Only where behavior depends on rendering/interactions that cannot be adequately verified in a pure service.

Minimum regression expectations for Challenge generation:

- 1, 2, 3, 4, 6, 8, 15, and >15 vocabulary items,
- maximum 3 new words per learning Challenge,
- remainder of 1 or 2,
- no future vocabulary in review,
- weak words prioritized,
- every usable item appears in final review,
- final review target/cap behavior,
- missing-image/audio fallback,
- no valid resource mode,
- replay behavior,
- interrupted attempt behavior,
- deterministic seeded generation where applicable.

---

## 12. Quality gates

Current repository quality commands include:

```bash
npm run lint
npm run test
npm run build
```

`npm run lint` includes repository architecture/style guards.

Do not bypass lint rules with broad disables unless the rule itself is intentionally being changed.

Do not silence TypeScript errors with unsafe casts merely to pass the build.

The GitHub Quality workflow runs typecheck, tests, lint, and build. Local work should aim to reproduce those guarantees before handing off a change.

---

## 13. Documentation and ADR rules

Update documentation in the same coherent change whenever implementation changes documented behavior.

Create a new ADR when a change establishes a durable architectural/product decision with meaningful alternatives or consequences.

Do not create an ADR for trivial refactoring.

When adding an ADR:

1. use the next ADR number,
2. mark status explicitly,
3. describe context,
4. record the decision,
5. record consequences,
6. update `architecture/ADR/ADR_INDEX.md`.

Canonical docs must describe current intended behavior, not a historical sequence of patches.

---

## 14. Security boundaries

Library/package content is untrusted declarative input.

Never:

- execute code from a library,
- inject library HTML,
- trust paths without validation,
- allow path traversal outside the package,
- dynamically import scripts from library content,
- store secrets in content packages.

Preserve the architecture guards against executable content and unsafe browser storage.

---

## 15. UI and styling rules

Use semantic CSS Custom Properties and existing design tokens.

Do not add arbitrary literal colors inside components when a semantic token exists.

Follow the existing responsive/mobile navigation architecture.

Keep parent-management controls in Parent Zone or other explicitly parent-facing surfaces.

Do not expose implementation/debug terminology in child-facing UI.

---

## 16. Scope discipline

Do not implement unrelated improvements while solving a requested change.

If you discover adjacent technical debt:

- note it,
- fix it only if it blocks the requested change or creates correctness/security risk,
- otherwise leave it for a separate coherent change and separate commit.

Never perform broad refactors solely because files are already open.

Preserve existing lesson/Quest content unless the task explicitly requests content changes.

When migrating library formats, preserve Quest vocabulary membership and order unless the migration specification explicitly changes them.

---

## 17. Required agent workflow

For every implementation request:

```text
1. Read CURRENT_IMPLEMENTATION + relevant specs/ADRs.
2. Inspect existing code and tests.
3. Define the smallest coherent change.
4. Implement it.
5. Add/update focused tests.
6. Update canonical docs if behavior changed.
7. Run focused tests/checks.
8. Review git diff and working tree.
9. Commit the coherent change.
10. Run npm run build as a post-commit action.
11. If build fails:
      fix → test → new commit → build again.
12. Continue with the next coherent change only after the latest commit builds successfully.
13. At handoff, report:
      - commits created,
      - tests/checks run,
      - final build result,
      - migrations/documentation changed,
      - unresolved issues, if any.
```

A task that requires multiple architectural steps should therefore result in multiple understandable commits rather than one monolithic final commit.

---

## 18. Definition of done

A change is done only when all applicable conditions are true:

- requested behavior is implemented,
- existing behavior not intentionally changed remains preserved,
- relevant tests pass,
- architecture/lint rules pass,
- persistence migration exists if needed,
- canonical documentation reflects the new behavior,
- a coherent commit exists,
- `npm run build` has passed **after that commit**,
- no generated artifacts, secrets, or unrelated changes were committed,
- final handoff clearly states what changed.

If the latest commit has not passed the post-commit build, the task is not complete.
