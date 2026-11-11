# Classroom Model: Implementation Documentation and Version History

An interactive 3D model of an after-school math classroom. It runs on a live daily Seoul (KST) schedule. Twelve students and one teacher arrive, take part in a "Golden Bell" math quiz, work on lessons, take recesses, and walk in and out through the doors. A demo mode replays each scenario in seconds so you can review it without waiting for the real schedule.

- **Stack:** React 19, Vite 8, TypeScript 5.7, Tailwind CSS v4 (global stylesheet), three.js 0.187, `@react-three/fiber` 9, `@react-three/drei` 10
- **Fonts:** DM Sans and Manrope (Google Fonts, imported in `src/index.css`)
- **Code size:** `src/App.tsx` is about 2,340 lines (all scene, simulation, and UI logic). `src/index.css` is about 900 lines (all overlay UI styling).
- **Backend:** none. All state is client-side. Only the panel layout is saved, in `localStorage`.

---

## 1. File map

| File | Role |
| --- | --- |
| `src/main.tsx` | Mounts `<App />` and imports `index.css`. |
| `src/App.tsx` | Types, schedule constants, quiz data, deterministic simulation functions, 3D components, camera rig, and the overlay UI. |
| `src/index.css` | Font imports, Tailwind import, base layer, and all overlay styles (top bar, panels, pills, toggles, demo dock, responsive and reduced-motion rules). |
| `index.html`, `vite.config.ts`, `.figma/` | Standard Figma Make scaffold (not changed by feature work). |

---

## 2. Architecture overview

The app is a **pure function of time**. Each tick, `App` works out the full state of the room from the current Seoul time, or from the demo clock in demo mode:

```
getSeoulTime() / demo clock
        │
        ▼
getClassStatus() / getDemoStatus()        → ClassStatus   (session, phase, Golden Bell progress)
        │
        ├─► getStudentSchedule() ×12 / getDemoStudentSchedule()  → StudentSchedule[]
        └─► getTeacherSchedule()     / getDemoTeacherSchedule()  → TeacherSchedule
        │
        ▼
<Scene> → <Classroom> → <StudentSprite> ×12, <TeacherSprite>, doors, clock, whiteboard
```

### Determinism

All "random" behaviour (arrival times, which door, snack versus leaving, quiz question selection, answer correctness, and so on) comes from `stableHash()`, an FNV-1a hash of a string key such as `${dateKey}-${sessionId}-${studentId}-arrival`.

This means:

- Reloading the page at the same moment gives the same scene.
- Every viewer sees the same classroom at the same KST time.
- Behaviour changes from day to day because the date is part of each key.

The only React state that is not derived from time is user configuration and manual commands (see section 6).

### Timing loops

- **Live clock:** `setInterval` runs every 1 s and updates `seoulTime` through `Intl.DateTimeFormat` with `timeZone: "Asia/Seoul"`.
- **Demo clock:** `setInterval` runs every 200 ms while demo mode is on. Elapsed time is `(demoNow - demoStartedAt) / 1000`.
- **Animation:** walking, turning, door swing and limb motion run in `useFrame` with frame-rate-independent damping (`THREE.MathUtils.damp` and exponential smoothing). The time-derived schedules only set *targets*. The sprites move toward those targets smoothly.

---

## 3. Daily schedule (live mode)

All times are KST and defined in `classSchedule`.

| Session | Start | End |
| --- | --- | --- |
| Class A | 16:00 | 17:50 |
| Class B | 18:10 | 21:00 |

A session becomes "active" **12 minutes before** it starts, which covers the teacher's early arrival. Phases inside a session (`getClassStatus`):

| Phase | When | Notes |
| --- | --- | --- |
| `arrival` | Before the start time | Students and teacher come in. |
| `golden` | First 50 min of cycle 0 | Golden Bell quiz (section 4). |
| `lesson` | First 50 min of cycles ≥ 1 | Textbook practice. |
| `break` | Last 10 min of every 60-min cycle | Recess. Students must be back 2 min before it ends (`returnBy`). |
| `none` | Outside sessions | Room is empty. The top bar shows the next class. |

Each phase has a unique `phaseKey`. When it changes, every student's manual command resets to "seated".

---

## 4. Golden Bell quiz

### Question bank

`goldenQuestions` holds 10 competition-style problems. Each has:

- a `prompt`
- a correct `answer`
- a plausible `wrong` answer
- three solution `steps`

Each question also has a difficulty level from 1 to 5 in `goldenDifficulties`.

### Session plan (`getGoldenProgress`)

1. **Question order:** a hash of the session seed sets a start offset, and questions run in sequence from there.
2. **Question count:** starts at 5–10 (hashed). If the 50-minute block can't give every question at least **60 s of solution time**, the count drops one question at a time, down to a minimum of 5.
3. **Each question has three stages:**
   - **thinking:** the answer window is `difficulty × 60 s` (level 3 = 3 minutes).
   - **reveal:** 15 s. All boards go up.
   - **solution:** the remaining time is split evenly across questions. The teacher explains the steps.
4. A `scale` parameter compresses all durations for demo mode. The demo uses `0.05`, so one minute becomes 3 s, inside a 90 s loop.

### Individual student timing (`getGoldenStudentAnswer`)

Each student has two hidden traits:

- **Math level:** 0.35–1.00, fixed for each student.
- **Concentration:** 0.45–1.00, different for each question.

Readiness is `mathLevel × concentration`. From readiness:

- **When the answer appears** (`answerAt`) is the answer window × `clamp(0.16 + (1 − readiness) × 0.78 × difficultyFactor + jitter, 0.12, 0.98)`. Stronger, more focused students answer sooner, and harder questions slow everyone down.
- **Chance of being correct** is `clamp(0.25 + readiness × 0.65 − (difficulty − 1) × 0.07, 0.12, 0.95)`. A wrong answer shows the question's `wrong` value.
- **Board position:** the board lies flat on the desk showing "..." until `answerAt`. It then rises above the head showing the answer. It stays up through the reveal stage.

The selected-student panel shows **Math**, **Focus** and **Shows at** values during the quiz.

### Whiteboard and teacher card

- **Whiteboard title:** `GOLDEN BELL · Qn/N · LEVEL d`
- **Body:** the question text, or during the solution stage an "EXEMPLARY SOLUTION" with the three numbered steps.
- **Footer:** countdown (`d MIN WINDOW · m:ss LEFT`), then `TIME · ALL BOARDS UP`, then `ANSWER: x`.
- **Teacher:** holds a yellow card above their head with `Qn` and the prompt. In the solution stage it switches to `SOLUTION / Answer: x`, and the teacher raises a pointer with the right arm.

### Textbook lessons (`getLessonProgress`)

In the cycles after the Golden Bell, the teacher works on an iPad. Its screen is mirrored through the projector onto the whiteboard, so the board shows the projected textbook page (`textbookProblems`: page, number, prompt, three steps, answer). Each 50-minute lesson alternates between two modes:

- **Explain (4–7 min):** the teacher stands at the desk holding the iPad and writes. The projected page shows the problem, then the steps one by one in blue ink, and then the boxed answer. Students show "Following on the board".
- **Marking round:** students try the next problem in their textbook while the teacher puts the iPad down and walks round the room with a red pen, giving each student 35–70 s, then 30 s to walk back. The next explain segment covers the same problem.
- **Route (`getVisitOrder`, `getMarkingSpot`, `planTeacherRoute`):** neighbouring columns share an aisle, so the teacher marks both sides from one spot. The teacher walks down the first aisle, crosses at the back lane, and comes up the next one. Paths use the front walkway (z = −3.72), the gap behind the teacher desk, and the lanes between rows, so the teacher does not walk through desks.
- **Marks:** a marked textbook shows a red tick, or a red cross if the student has to fix it. The chance of a tick depends on the student's math level. The board footer shows `MARKING · m/n CHECKED`.
- Demo: explain lasts 16–20 s, each visit 6–8 s, and the teacher walks faster (1.55 u/s).

---

## 5. People simulation

### Students (`getStudentSchedule`)

- **Arrival:** each student arrives 1–10 minutes before class starts (hashed). They enter through one of two doors over a 15 s walk-in.
- **Door choice:** if the rear student door is turned off, everyone uses the teacher door. Otherwise the door is picked by hash for each trip.
- **Golden Bell and lessons:** students sit at their desk. During lessons a textbook lies on the desk. During the quiz, the answer board is shown as described in section 4.
- **Recess:** each student has a 50/50 chance to do one of two things:
  - **Snack:** stays seated with a lunchbox, drink and plate.
  - **Step out:** leaves 20–120 s into recess, is away, and returns 6:00–7:45 into recess. The 15 s walk back finishes by the 8-minute mark. The doors used to leave and return can differ.
- **Status label** (selected student): Not arrived, Arriving, Solving, Thinking, Shown x, Reviewing solution, Snacking, On break, Leaving, Away on break, Returning, Pitching, At door, Off campus.

### Teacher (`getTeacherSchedule`)

- **Arrival:** 8–12 min before class, through the front (teacher) door. The 15 s walk goes from the door to a waypoint and then to the desk, so it avoids cutting the corner.
- **During class:** status is "Teaching".
- **Recess:** a 30% chance of leaving the room for 1–8 min. The leave time is chosen so the teacher is always back before recess ends. Otherwise status is "On recess".

### Locomotion and animation (`StudentSprite`, `TeacherSprite`)

- **Movement speed:** constant walking speed toward the target (students 1.1 u/s, teacher 1.05 u/s). This avoids eased "sliding".
- **Facing direction:** the body turns smoothly toward the direction of travel.
- **Walk cycle:** legs and arms swing in opposite phase, with a small vertical bob.
- **Seated pose:** a separate model with bent legs and forearms resting on the desk.
- **Doors:** a door opens automatically while anyone is walking through it. The swing is damped to 90°.
- **Students are low-poly figures:** shirt, skin and hair colours vary by student ID.
- **The teacher is a separate figure:** glasses, a lanyard, and a sage top.

---

## 6. User interaction

### In the 3D scene

- Drag to orbit and scroll to zoom (OrbitControls with damping). Panning works only in Dollhouse view.
- Click a student to select them. A ring appears at their feet, plus a floating green arrow and their name.
- Click the wall clock to jump to the Clock close-up view.

### Selected student panel

Manual commands, available only while the student is present and not walking through a door:

- **Sit & solve:** returns to the chair.
- **Stand & pitch:** stands at the seat with an arm raised.
- **Open / Close rear door:** walks to the rear door and toggles it on arrival. Disabled when the rear door is hidden.

Scheduled transitions (entering or leaving) always override manual commands.

### Viewpoint panel

- **Views:**
  - **Dollhouse:** orbiting overview.
  - **Teacher eye:** first-person from the teacher desk. It follows the "Move teaching station" setting.
  - **Clock:** close-up, opened by clicking the clock.
- **Move teaching station:** mirrors the teacher desk, chair and teacher to the left or right.
- **3 × 4 desk layout:** switches between 4 columns × 3 rows and 3 columns × 4 rows.
- **Digital classroom clock:** switches between the analog clock with a second hand and a digital KST display.
- **Rear student door:** shows or removes the second door. When removed, all trips use the teacher door.

### Demo dock

Demo mode pauses the live schedule and replays a scenario from t = 0. Each button restarts its scenario with a new run seed.

| Scenario | What it shows | Timeline |
| --- | --- | --- |
| Arrival | Teacher walks in, then students arrive one by one (staggered 0.65 s) through both doors. | ~12 s walks, starting at 2 s |
| Golden Bell | Full quiz with individual answer timing. 1 min becomes 3 s. | 90 s loop |
| Snack break | Everyone seated with snacks. Teacher "On recess". | static |
| Leave & return | Every 3rd student snacks. The others leave, are away, and come back in a staggered order. The teacher also leaves and returns. | ~30 s |
| Lesson | Teacher explains a textbook problem on the iPad (projected), then walks the aisles marking each textbook. | ~110 s per explain + round |

### Panel management

- **Focus:** hides all controls for a clean presentation view.
- **Collapsing:** each panel (student, view, demo) folds into a small "pill" that summarises its state.
- **Saving:** collapsed and expanded state is saved in `localStorage` (`classroom-panel-state-v1`).
- **Mobile:** on screens 720 px wide or less, panels start collapsed.
- **Info card** (top right): layout, students present, teacher status, and schedule summary.

---

## 7. 3D scene composition

| Element | Notes |
| --- | --- |
| Floor slab | Rounded slab with plank lines. |
| Back wall | Three dark windows, a green WELCOME board, and the whiteboard. |
| Left wall | Glass partition containing the TEACHER door (front) and the STUDENTS door (rear, optional). |
| Desks | 12 student oak desks with black chairs. The teacher desk is white and has a laptop and papers. |
| Clock | Analog or digital, at the centre of the back wall. |
| Lighting | Three ceiling light panels using `rectAreaLight`, a projector, ambient light, a shadow-casting directional light, and a cool fill point light. |
| Surroundings | Contact shadows, a warm dark background with fog, and a CSS vignette and warm glow overlay. |

---

## 8. Review notes and known limitations

- **Single-file design:** all logic lives in `App.tsx`. Possible splits:
  - `simulation.ts`: schedule and quiz functions, which are pure and easy to unit test.
  - `scene/`: 3D components.
  - `ui/`: panels.
- **No automated tests.** The simulation functions are pure and deterministic, so they are good first candidates for tests (for example, quiz timing always fits 50 minutes, and students always return by `returnBy`).
- **Straight-line paths:** students walk directly between door and seat, so they can pass through desks. Only the teacher uses a waypoint.
- **Quiz end state:** after the last Golden Bell question, the final question's solution stays shown until the 50-minute block ends.
- **Fixed schedule:** the same timetable every day, weekends included. Only the hashed variations change by date.
- **Live-mode review:** behaviour can only be seen at the real KST times. Use demo mode for review.
- **`controls` ref** in `CameraRig` is typed as `any`.

---

## 9. Version history

The Git history starts at prompt 140. The first commit is a snapshot containing the whole project as built over earlier prompts. **Your original prompt wording is not stored in the repository.** Each "Prompt" below is a reconstruction of the request based on the code it produced. Please replace them with your exact wording if needed.

### v1 · `8da6f6d` · 2026-11-11 · Prompt #140: "Add natural student walking animation"

**Prompt (reconstructed):** make the students walk naturally instead of sliding into place.

**Feature:**

- Constant-speed walking with a leg and arm swing cycle, body bob, and smooth turning toward the direction of travel.

**Baseline included in this snapshot** (from earlier prompts):

- 3D classroom with 12 desks in a switchable 4×3 or 3×4 layout.
- Teacher desk that can move left or right.
- Dollhouse and Teacher-eye views.
- Teacher door and an optional rear student door.
- Analog or digital Seoul clock with a clock close-up view.
- Live Class A and B schedule with arrivals, lessons and recesses (snacking or leaving the room).
- First version of the Golden Bell quiz: write an answer, then show the boards.
- Student selection with Sit, Pitch and Door commands.
- Demo mode with five scenarios.
- Collapsible panels and Focus mode.

### v2 · `4c189c3` · Prompt #160: "Expand Golden Bell solution flow"

**Prompt (reconstructed):** after students show their answers, the teacher should explain the solution.

**Feature:**

- Three solution steps added to every question.
- Quiz stages are now thinking, reveal and solution.
- The whiteboard shows an "Exemplary solution", and the student status shows "Reviewing solution".
- Question order is randomized per session with a hashed offset, and each session has 5–10 questions.
- Demo: 6 questions on a 72 s loop.

### v3 · `a1b23da` · Prompt #170: "Add scheduled teacher sprite"

**Prompt (reconstructed):** add a teacher who follows a schedule like the students.

**Feature:**

- New animated `TeacherSprite` that arrives 8–12 min early through the teacher door, using a waypoint route.
- During recess the teacher has a 30% chance of stepping out for 1–8 min and always returns before class.
- Holds a question or solution card and gestures with a pointer during the solution stage.
- Teacher status appears in the info card.
- Demo Arrival and Leave & return scenarios include the teacher.
- The active session window now opens 12 minutes before class.

### v4 · `5589779` · Prompt #180: "Add individual Golden Bell answer timing"

**Prompt (reconstructed):** students should not all answer at once. Timing should depend on their math level, concentration, and the question's difficulty.

**Feature:**

- Difficulty levels 1–5 for each question, with an answer window of `difficulty × 1 min`.
- 15 s reveal, and the solution time is fitted to the 50-minute block, dropping questions if needed (minimum 5).
- Each student's answer time and correctness come from their math level and concentration.
- Live countdowns appear on the whiteboard and in the top bar.
- The student panel shows Math, Focus and Shows at values (new `.student-meta` styles).
- Demo uses the same algorithm with a time scale of 0.05 on a 90 s loop.

---

## 10. How to review

1. Open the preview and turn on **Demo mode** in the bottom dock.
2. Run **Golden Bell**. Click several students and compare their Shows at times. Watch the reveal, then the whiteboard solution and the teacher's pointer.
3. Run **Arrival** and **Leave & return**. Watch the walk cycles and the automatic door swing on both doors. Turn the rear door off and rerun to see everyone use the teacher door.
4. In the Viewpoint panel, toggle the desk layout and teaching station, switch to Teacher eye, and click the clock.
5. Turn demo mode off to see the live state for the current KST time.
