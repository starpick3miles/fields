import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type ViewMode = "dollhouse" | "teacher" | "clock";
type Allocation = "4x3" | "3x4";
type StudentAction = "seated" | "standing" | "door";
type ClockMode = "analog" | "digital";

type StudentCommand = {
  action: StudentAction;
  commandId: number;
};

type ClassSession = {
  id: "A" | "B";
  startsAt: number;
  endsAt: number;
};

type ClassPhase = "none" | "arrival" | "golden" | "lesson" | "break";
type DoorId = "teacher" | "student";
type StudentActivity = "waiting" | "lesson" | "golden" | "snack" | "rest" | "away" | "absent";
type DemoScenario = "arrival" | "golden" | "recess" | "lesson";
type LessonProgress = {
  // explain: teacher solves on the iPad, mirrored to the board; marking: teacher walks the room.
  mode: "idle" | "explain" | "marking";
  problemId: number;
  round: number;
  stepsShown: number;
  answerShown: boolean;
  // During marking, the index into the visit order; equal to visitCount while walking back.
  visitIndex: number;
  visitCount: number;
  segmentRemaining: number;
};
type LessonTiming = {
  explain: [number, number];
  visit: [number, number];
  returnSlot: number;
};
type MarkingState = "none" | "waiting" | "current" | "marked";
type PanelState = {
  student: boolean;
  view: boolean;
  demo: boolean;
  focus: boolean;
};

const panelStorageKey = "classroom-panel-state-v1";

function getInitialPanelState(): PanelState {
  const fallback = window.matchMedia("(max-width: 720px)").matches;
  const defaults = { student: fallback, view: fallback, demo: fallback, focus: false };
  try {
    const saved = window.localStorage.getItem(panelStorageKey);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

type ClassStatus = {
  session?: ClassSession;
  phase: ClassPhase;
  cycle: number;
  phaseKey: string | null;
  phaseEndsAt?: number;
  returnBy?: number;
  questionIndex: number;
  questionId: number;
  questionCount: number;
  difficulty: number;
  answerSeconds: number;
  questionElapsed: number;
  answerSeed: string;
  goldenStage: "thinking" | "reveal" | "solution";
  reveal: boolean;
  lesson: LessonProgress;
};

type StudentSchedule = {
  present: boolean;
  transition: "none" | "entering" | "leaving";
  door: DoorId;
  transitionKey: string;
  activity: StudentActivity;
  answer: string;
  showBoard: boolean;
  answerAt: number;
  mathLevel: number;
  concentration: number;
  marking: MarkingState;
  markCorrect: boolean;
};

type TeacherSchedule = {
  present: boolean;
  transition: "none" | "entering" | "leaving";
  transitionKey: string;
  status: "Not arrived" | "Arriving" | "Teaching" | "On recess" | "Leaving" | "Away" | "Returning";
};

const oak = "#b97732";
const darkMetal = "#202321";
const wall = "#d8d2c9";
const classSchedule: ClassSession[] = [
  { id: "A", startsAt: 16 * 60 * 60, endsAt: 17 * 60 * 60 + 50 * 60 },
  { id: "B", startsAt: 18 * 60 * 60 + 10 * 60, endsAt: 21 * 60 * 60 },
];
const goldenQuestions = [
  {
    prompt: "What is 1 + 2 + 3 + … + 100?",
    answer: "5050",
    wrong: "5000",
    steps: ["Pair 1 + 100, 2 + 99, …", "Each pair totals 101", "50 pairs: 50 × 101 = 5050"],
  },
  {
    prompt: "6 people shake hands once with each other. How many handshakes?",
    answer: "15",
    wrong: "30",
    steps: ["Each person shakes 5 hands", "6 × 5 counts each twice", "30 ÷ 2 = 15"],
  },
  {
    prompt: "Find the next term: 2, 6, 12, 20, ?",
    answer: "30",
    wrong: "28",
    steps: ["Differences are 4, 6, 8", "Next difference is 10", "20 + 10 = 30"],
  },
  {
    prompt: "How many squares of any size are on a 3 × 3 grid?",
    answer: "14",
    wrong: "9",
    steps: ["1 × 1 squares: 9", "2 × 2 squares: 4", "3 × 3 squares: 1, total 14"],
  },
  {
    prompt: "Smallest n > 1 leaving remainder 1 when divided by 2, 3, and 4?",
    answer: "13",
    wrong: "7",
    steps: ["n − 1 is divisible by 2, 3, 4", "LCM(2, 3, 4) = 12", "n = 12 + 1 = 13"],
  },
  {
    prompt: "What is the last digit of 7¹⁰⁰?",
    answer: "1",
    wrong: "7",
    steps: ["Last digits cycle 7, 9, 3, 1", "The cycle length is 4", "100 is divisible by 4 → 1"],
  },
  {
    prompt: "Four tests average 80. What 5th score makes the average 82?",
    answer: "90",
    wrong: "84",
    steps: ["Current total: 4 × 80 = 320", "Needed total: 5 × 82 = 410", "410 − 320 = 90"],
  },
  {
    prompt: "How many diagonals does a hexagon have?",
    answer: "9",
    wrong: "6",
    steps: ["Each vertex joins 3 non-neighbors", "6 × 3 = 18 counts twice", "18 ÷ 2 = 9"],
  },
  {
    prompt: "How many two-digit numbers have digits that sum to 9?",
    answer: "9",
    wrong: "10",
    steps: ["Tens digit can be 1 to 9", "Units digit is 9 − tens", "18, 27, …, 90 gives 9"],
  },
  {
    prompt: "What is the smaller angle between clock hands at 3:30?",
    answer: "75°",
    wrong: "90°",
    steps: ["Minute hand is at 180°", "Hour hand is at 90° + 15°", "180° − 105° = 75°"],
  },
];
const demoScenarios: { id: DemoScenario; label: string; detail: string }[] = [
  { id: "arrival", label: "Arrival", detail: "Enter by visible doors" },
  { id: "golden", label: "Golden Bell", detail: "Individual answer timing" },
  { id: "recess", label: "Recess", detail: "Snack or leave & return" },
  { id: "lesson", label: "Lesson", detail: "Explain & mark textbooks" },
];
const textbookProblems = [
  {
    page: 46,
    number: 2,
    prompt: "Solve 3x + 7 = 22",
    steps: ["Subtract 7 from both sides: 3x = 15", "Divide both sides by 3", "x = 15 ÷ 3"],
    answer: "x = 5",
  },
  {
    page: 46,
    number: 5,
    prompt: "A rectangle has perimeter 36 cm and width 7 cm. Find its area.",
    steps: ["2(l + 7) = 36", "l + 7 = 18, so l = 11", "Area = 11 × 7"],
    answer: "77 cm²",
  },
  {
    page: 47,
    number: 1,
    prompt: "Simplify 4(2a − 3) − 5a",
    steps: ["Expand: 8a − 12 − 5a", "Collect a terms: 8a − 5a = 3a", "Keep the constant: −12"],
    answer: "3a − 12",
  },
  {
    page: 47,
    number: 4,
    prompt: "30% of a number is 27. What is the number?",
    steps: ["Write it as 0.3 × n = 27", "Divide: n = 27 ÷ 0.3", "27 ÷ 0.3 = 90"],
    answer: "n = 90",
  },
  {
    page: 48,
    number: 3,
    prompt: "Find the slope of the line through (1, 2) and (4, 11).",
    steps: ["Rise: 11 − 2 = 9", "Run: 4 − 1 = 3", "Slope = rise ÷ run = 9 ÷ 3"],
    answer: "slope = 3",
  },
  {
    page: 48,
    number: 6,
    prompt: "Solve 2(x − 4) = x + 5",
    steps: ["Expand: 2x − 8 = x + 5", "Subtract x: x − 8 = 5", "Add 8 to both sides"],
    answer: "x = 13",
  },
  {
    page: 49,
    number: 2,
    prompt: "The angles of a triangle are x, 2x and 3x. Find x.",
    steps: ["Angles sum to 180°: x + 2x + 3x", "6x = 180°", "x = 180° ÷ 6"],
    answer: "x = 30°",
  },
  {
    page: 49,
    number: 5,
    prompt: "A $40 price rises 15%, then falls 10%. What is the new price?",
    steps: ["After the rise: 40 × 1.15 = 46", "After the fall: 46 × 0.9", "46 × 0.9 = 41.4"],
    answer: "$41.40",
  },
];
const liveLessonTiming: LessonTiming = { explain: [240, 420], visit: [35, 70], returnSlot: 30 };
// Demo visits stay long enough for the teacher to walk between aisles and still mark.
const demoLessonTiming: LessonTiming = { explain: [16, 20], visit: [6, 8], returnSlot: 7 };
const idleLesson: LessonProgress = {
  mode: "idle",
  problemId: 0,
  round: 0,
  stepsShown: 0,
  answerShown: false,
  visitIndex: -1,
  visitCount: 0,
  segmentRemaining: 0,
};
const maxStudents = 12;
const goldenDifficulties = [2, 2, 1, 3, 4, 4, 2, 3, 3, 5];
const idleGolden = {
  questionIndex: 0,
  questionId: 0,
  questionCount: 0,
  difficulty: 1,
  answerSeconds: 60,
  questionElapsed: 0,
  answerSeed: "idle",
  goldenStage: "thinking" as const,
  reveal: false,
  lesson: idleLesson,
};
const studentNames = [
  "Alex",
  "Maya",
  "Jordan",
  "Sofia",
  "Noah",
  "Priya",
  "Eli",
  "Zoe",
  "Mateo",
  "Lina",
  "Sam",
  "Avery",
];

function getGrid(allocation: Allocation) {
  const columns = allocation === "4x3" ? [-3.75, -1.25, 1.25, 3.75] : [-3.5, 0, 3.5];
  const rows = allocation === "4x3" ? [-2.65, 0.45, 3.55] : [-2.8, -0.55, 1.7, 3.95];
  return { columns, rows };
}

function getStations(allocation: Allocation) {
  const { columns, rows } = getGrid(allocation);
  return rows.flatMap((z) => columns.map((x) => ({ x, z })));
}

// Front walkway between the teacher desk and the first row, and the central gap behind the desk.
const frontLaneZ = -3.72;
const frontRearZ = -5.62;

function getMarkingSpot(allocation: Allocation, studentId: number) {
  const { columns, rows } = getGrid(allocation);
  const column = studentId % columns.length;
  const row = Math.floor(studentId / columns.length);
  const x = columns[column];
  const z = rows[row];
  const pairStart = Math.floor(column / 2) * 2;
  // Neighbouring columns share an aisle so the teacher can mark both sides without moving.
  const aisleX =
    pairStart + 1 < columns.length
      ? (columns[pairStart] + columns[pairStart + 1]) / 2
      : x - (columns[1] - columns[0]) / 2;
  const standZ = z + 0.42;
  // Lane between this row's chair backs (z + 1.2) and the next row's desk fronts.
  const laneZ = z + (1.2 + (rows[1] - rows[0]) - 0.39) / 2;
  return {
    point: new THREE.Vector3(aisleX, 0, standZ),
    laneZ,
    facing: Math.atan2(-(x - aisleX), -(z - standZ)),
  };
}

function getVisitOrder(allocation: Allocation, presentIds: number[]) {
  const { columns, rows } = getGrid(allocation);
  const order: number[] = [];
  // Walk down the first aisle, cross at the back, then come up the next aisle.
  for (let pair = 0; pair * 2 < columns.length; pair += 1) {
    const rowOrder = rows.map((_, row) => row);
    if (pair % 2 === 1) rowOrder.reverse();
    for (const row of rowOrder) {
      for (let column = pair * 2; column < Math.min(pair * 2 + 2, columns.length); column += 1) {
        const id = row * columns.length + column;
        if (presentIds.includes(id)) order.push(id);
      }
    }
  }
  return order;
}

function planTeacherRoute(from: THREE.Vector3, to: THREE.Vector3, fromLaneZ?: number) {
  const fromFront = from.z < -4.6;
  const toFront = to.z < -4.6;
  if (fromFront && toFront) return [to];
  if (fromFront) {
    return [
      new THREE.Vector3(0, 0, frontRearZ),
      new THREE.Vector3(0, 0, frontLaneZ),
      new THREE.Vector3(to.x, 0, frontLaneZ),
      to,
    ];
  }
  if (toFront) {
    return [
      new THREE.Vector3(from.x, 0, frontLaneZ),
      new THREE.Vector3(0, 0, frontLaneZ),
      new THREE.Vector3(0, 0, frontRearZ),
      to,
    ];
  }
  if (Math.abs(from.x - to.x) < 0.05 || fromLaneZ === undefined) return [to];
  return [new THREE.Vector3(from.x, 0, fromLaneZ), new THREE.Vector3(to.x, 0, fromLaneZ), to];
}

function getLessonProgress(
  seed: string,
  elapsed: number,
  timing: LessonTiming,
  visitCount: number,
): LessonProgress {
  const offset = stableHash(`${seed}-lesson-offset`) % textbookProblems.length;
  const pick = ([min, max]: [number, number], key: string) =>
    min + (stableHash(key) % 1000) * ((max - min) / 1000);
  let cursor = 0;

  // Explain one problem, let students try the next one while the teacher marks, then explain it.
  for (let round = 0; round < 200; round += 1) {
    const explainSeconds = pick(timing.explain, `${seed}-explain-${round}`);
    if (elapsed < cursor + explainSeconds) {
      const progress = (elapsed - cursor) / explainSeconds;
      return {
        mode: "explain",
        problemId: (offset + round) % textbookProblems.length,
        round,
        stepsShown: progress < 0.14 ? 0 : progress < 0.38 ? 1 : progress < 0.62 ? 2 : 3,
        answerShown: progress >= 0.8,
        visitIndex: -1,
        visitCount,
        segmentRemaining: cursor + explainSeconds - elapsed,
      };
    }
    cursor += explainSeconds;

    const visits = Array.from({ length: visitCount }, (_, visit) =>
      pick(timing.visit, `${seed}-round-${round}-visit-${visit}`),
    );
    const roundSeconds = visits.reduce((total, seconds) => total + seconds, timing.returnSlot);
    if (elapsed < cursor + roundSeconds) {
      let visitIndex = visitCount;
      let visitCursor = cursor;
      for (let visit = 0; visit < visitCount; visit += 1) {
        if (elapsed < visitCursor + visits[visit]) {
          visitIndex = visit;
          break;
        }
        visitCursor += visits[visit];
      }
      return {
        mode: "marking",
        problemId: (offset + round + 1) % textbookProblems.length,
        round,
        stepsShown: 0,
        answerShown: false,
        visitIndex,
        visitCount,
        segmentRemaining: cursor + roundSeconds - elapsed,
      };
    }
    cursor += roundSeconds;
  }

  return idleLesson;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getArrivalTime(dateKey: string, session: ClassSession, studentId: number) {
  const offset = 60 + (stableHash(`${dateKey}-${session.id}-${studentId}-arrival`) % 541);
  return session.startsAt - offset;
}

function getEntryDoor(
  dateKey: string,
  session: ClassSession,
  studentId: number,
  studentDoor: boolean,
) {
  return getDoor(`${dateKey}-${session.id}-${studentId}-door`, studentDoor);
}

function getDoor(key: string, studentDoor: boolean): DoorId {
  if (!studentDoor) return "teacher";
  return stableHash(key) % 2 === 0 ? "teacher" : "student";
}

function formatSeconds(seconds: number) {
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function getClassStatus(now: number, dateKey: string): ClassStatus {
  const idle = idleGolden;
  const session = classSchedule.find(
    // The schedule opens early enough for the teacher's 8-12 minute pre-class arrival.
    (candidate) => now >= candidate.startsAt - 12 * 60 && now < candidate.endsAt,
  );
  if (!session) {
    return { phase: "none", cycle: 0, phaseKey: null, ...idle };
  }

  const elapsed = now - session.startsAt;
  if (elapsed < 0) {
    return {
      session,
      phase: "arrival",
      cycle: 0,
      phaseKey: `${dateKey}-${session.id}-arrival`,
      phaseEndsAt: session.startsAt,
      ...idle,
    };
  }

  // Every class repeats a 50-minute lesson followed by a 10-minute recess.
  const cycle = Math.floor(elapsed / 3600);
  const cycleElapsed = elapsed % 3600;
  const cycleStart = session.startsAt + cycle * 3600;
  if (cycleElapsed < 50 * 60) {
    const golden =
      cycle === 0 ? getGoldenProgress(`${dateKey}-${session.id}`, cycleElapsed, 50 * 60) : idle;
    const lesson =
      cycle === 0
        ? idleLesson
        : getLessonProgress(
            `${dateKey}-${session.id}-${cycle}`,
            cycleElapsed,
            liveLessonTiming,
            maxStudents,
          );
    return {
      session,
      phase: cycle === 0 ? "golden" : "lesson",
      cycle,
      phaseKey: `${dateKey}-${session.id}-${cycle === 0 ? "golden" : "lesson"}-${cycle}`,
      phaseEndsAt: cycleStart + 50 * 60,
      ...golden,
      lesson,
    };
  }

  return {
    session,
    phase: "break",
    cycle,
    phaseKey: `${dateKey}-${session.id}-break-${cycle}`,
    phaseEndsAt: cycleStart + 60 * 60,
    returnBy: cycleStart + 58 * 60,
    ...idle,
  };
}

function getGoldenProgress(seed: string, elapsed: number, duration: number, scale = 1) {
  const offset = stableHash(`${seed}-golden-offset`) % goldenQuestions.length;
  const revealSeconds = 15 * scale;
  const minimumSolutionSeconds = 60 * scale;
  const getIds = (count: number) =>
    Array.from({ length: count }, (_, index) => (offset + index) % goldenQuestions.length);
  const getAnswerTotal = (ids: number[]) =>
    ids.reduce((total, id) => total + goldenDifficulties[id] * 60 * scale, 0);
  let questionCount = 5 + (stableHash(`${seed}-golden-count`) % 6);

  // Keep 5-10 questions, removing hard questions only when the 50-minute block cannot fit solutions.
  while (questionCount > 5) {
    const ids = getIds(questionCount);
    const solutionSeconds =
      (duration - getAnswerTotal(ids) - revealSeconds * questionCount) / questionCount;
    if (solutionSeconds >= minimumSolutionSeconds) break;
    questionCount -= 1;
  }

  const questionIds = getIds(questionCount);
  const solutionSeconds =
    (duration - getAnswerTotal(questionIds) - revealSeconds * questionCount) / questionCount;
  let cursor = 0;

  for (let questionIndex = 0; questionIndex < questionCount; questionIndex += 1) {
    const questionId = questionIds[questionIndex];
    const difficulty = goldenDifficulties[questionId];
    const answerSeconds = difficulty * 60 * scale;
    const questionSeconds = answerSeconds + revealSeconds + solutionSeconds;
    if (elapsed < cursor + questionSeconds || questionIndex === questionCount - 1) {
      const questionElapsed = Math.max(0, elapsed - cursor);
      const goldenStage: ClassStatus["goldenStage"] =
        questionElapsed < answerSeconds
          ? "thinking"
          : questionElapsed < answerSeconds + revealSeconds
            ? "reveal"
            : "solution";
      return {
        questionIndex,
        questionId,
        questionCount,
        difficulty,
        answerSeconds,
        questionElapsed,
        answerSeed: `${seed}-${questionIndex}-${questionId}`,
        goldenStage,
        reveal: goldenStage === "reveal",
        lesson: idleLesson,
      };
    }
    cursor += questionSeconds;
  }

  return idleGolden;
}

function getGoldenStudentAnswer(studentId: number, status: ClassStatus) {
  const question = goldenQuestions[status.questionId];
  const mathLevel = 0.35 + (stableHash(`student-${studentId}-math-level`) % 66) / 100;
  const concentration = 0.45 + (stableHash(`${status.answerSeed}-${studentId}-focus`) % 56) / 100;
  const readiness = mathLevel * concentration;
  const difficultyFactor = 0.55 + status.difficulty * 0.09;
  const jitter = (stableHash(`${status.answerSeed}-${studentId}-timing`) % 9) / 100;
  const answerRatio = THREE.MathUtils.clamp(
    0.16 + (1 - readiness) * 0.78 * difficultyFactor + jitter,
    0.12,
    0.98,
  );
  const answerAt = status.answerSeconds * answerRatio;
  const correctChance = THREE.MathUtils.clamp(
    0.25 + readiness * 0.65 - (status.difficulty - 1) * 0.07,
    0.12,
    0.95,
  );
  const correct =
    (stableHash(`${status.answerSeed}-${studentId}-correct`) % 1000) / 1000 < correctChance;

  return {
    answer: correct ? question.answer : question.wrong,
    showBoard:
      status.goldenStage === "reveal" ||
      (status.goldenStage === "thinking" && status.questionElapsed >= answerAt),
    answerAt,
    mathLevel,
    concentration,
  };
}

function getStudentSchedule(
  studentId: number,
  now: number,
  dateKey: string,
  studentDoor: boolean,
  status: ClassStatus,
): StudentSchedule {
  const absent: StudentSchedule = {
    present: false,
    transition: "none",
    door: "teacher",
    transitionKey: `${dateKey}-none-${studentId}`,
    activity: "away",
    answer: "",
    showBoard: false,
    answerAt: 0,
    mathLevel: 0,
    concentration: 0,
    marking: "none",
    markCorrect: false,
  };
  if (!status.session) return absent;

  const session = status.session;
  const arrival = getArrivalTime(dateKey, session, studentId);
  if (now < arrival) return { ...absent, activity: "waiting" };
  if (now - arrival < 15) {
    return {
      ...absent,
      present: true,
      transition: "entering",
      door: getEntryDoor(dateKey, session, studentId, studentDoor),
      transitionKey: `${dateKey}-${session.id}-arrival-${studentId}`,
      activity: "lesson",
    };
  }

  if (status.phase === "golden") {
    return {
      ...absent,
      present: true,
      activity: "golden",
      ...getGoldenStudentAnswer(studentId, status),
    };
  }

  if (status.phase === "break" && status.phaseEndsAt) {
    const breakStart = status.phaseEndsAt - 10 * 60;
    const prefix = `${dateKey}-${session.id}-break-${status.cycle}-${studentId}`;
    if (stableHash(`${prefix}-plan`) % 2 === 0) {
      return { ...absent, present: true, activity: "snack" };
    }

    const leaveAt = breakStart + 20 + (stableHash(`${prefix}-leave`) % 101);
    // Returning entries finish no later than eight minutes into recess.
    const returnAt = breakStart + 6 * 60 + (stableHash(`${prefix}-return`) % 106);
    const leaveDoor = getDoor(`${prefix}-leave-door`, studentDoor);
    const returnDoor = getDoor(`${prefix}-return-door`, studentDoor);

    if (now < leaveAt) return { ...absent, present: true, activity: "rest" };
    if (now < leaveAt + 15) {
      return {
        ...absent,
        present: true,
        transition: "leaving",
        door: leaveDoor,
        transitionKey: `${prefix}-leaving`,
        activity: "rest",
      };
    }
    if (now < returnAt) return { ...absent, door: leaveDoor, activity: "away" };
    if (now < returnAt + 15) {
      return {
        ...absent,
        present: true,
        transition: "entering",
        door: returnDoor,
        transitionKey: `${prefix}-returning`,
        activity: "rest",
      };
    }
    return { ...absent, present: true, activity: "rest" };
  }

  return { ...absent, present: true, activity: "lesson" };
}

function getDemoStatus(
  scenario: DemoScenario,
  elapsed: number,
  run: number,
  studentCount: number,
): ClassStatus {
  const session = classSchedule[0];
  const base = {
    session,
    cycle: 0,
    phaseKey: `demo-${run}-${scenario}`,
    ...idleGolden,
  };

  if (scenario === "arrival") {
    return { ...base, phase: "arrival", phaseEndsAt: session.startsAt };
  }
  if (scenario === "golden") {
    // Demo minutes become three-second answer windows while preserving each student's pacing.
    return {
      ...base,
      phase: "golden",
      phaseEndsAt: session.startsAt + 50 * 60,
      ...getGoldenProgress(`demo-${run}`, elapsed % 90, 90, 0.05),
    };
  }
  if (scenario === "lesson") {
    return {
      ...base,
      phase: "lesson",
      cycle: 1,
      phaseEndsAt: session.startsAt + 110 * 60,
      lesson: getLessonProgress(`demo-${run}`, elapsed, demoLessonTiming, studentCount),
    };
  }
  return {
    ...base,
    phase: "break",
    phaseEndsAt: session.startsAt + 60 * 60,
    returnBy: session.startsAt + 58 * 60,
  };
}

function getDemoStudentSchedule(
  studentId: number,
  scenario: DemoScenario,
  elapsed: number,
  run: number,
  studentDoor: boolean,
  status: ClassStatus,
  studentCount: number,
): StudentSchedule {
  const key = `demo-${run}-${studentId}`;
  const base: StudentSchedule = {
    present: true,
    transition: "none",
    door: "teacher",
    transitionKey: key,
    activity: "lesson",
    answer: "",
    showBoard: false,
    answerAt: 0,
    mathLevel: 0,
    concentration: 0,
    marking: "none",
    markCorrect: false,
  };

  if (studentId >= studentCount) return { ...base, present: false, activity: "absent" };

  if (scenario === "arrival") {
    const arriveAt = 2 + studentId * 0.65;
    if (elapsed < arriveAt) return { ...base, present: false, activity: "waiting" };
    if (elapsed < arriveAt + 12) {
      return {
        ...base,
        transition: "entering",
        door: getDoor(`${key}-arrival-door`, studentDoor),
        transitionKey: `${key}-arrival`,
      };
    }
    return base;
  }

  if (scenario === "golden") {
    return {
      ...base,
      activity: "golden",
      ...getGoldenStudentAnswer(studentId, status),
    };
  }

  if (scenario === "lesson") return base;

  // Recess: every third student snacks at their desk while the rest step out and return.
  if (studentId % 3 === 0) return { ...base, activity: "snack" };
  const stagger = (studentId % 6) * 0.45;
  const leaveAt = stagger;
  const returnAt = 16 + stagger;
  if (elapsed < leaveAt) return { ...base, activity: "rest" };
  if (elapsed < leaveAt + 12) {
    return {
      ...base,
      transition: "leaving",
      door: getDoor(`${key}-leave-door`, studentDoor),
      transitionKey: `${key}-leaving`,
      activity: "rest",
    };
  }
  if (elapsed < returnAt) return { ...base, present: false, activity: "away" };
  if (elapsed < returnAt + 12) {
    return {
      ...base,
      transition: "entering",
      door: getDoor(`${key}-return-door`, studentDoor),
      transitionKey: `${key}-returning`,
      activity: "rest",
    };
  }
  return { ...base, activity: "rest" };
}

function getTeacherSchedule(now: number, dateKey: string, status: ClassStatus): TeacherSchedule {
  const absent: TeacherSchedule = {
    present: false,
    transition: "none",
    transitionKey: `${dateKey}-teacher-none`,
    status: "Not arrived",
  };
  if (!status.session) return absent;

  const session = status.session;
  const prefix = `${dateKey}-${session.id}-teacher`;
  const arrival = session.startsAt - (8 * 60 + (stableHash(`${prefix}-arrival`) % 241));
  if (now < arrival) return absent;
  if (now - arrival < 15) {
    return {
      present: true,
      transition: "entering",
      transitionKey: `${prefix}-arrival`,
      status: "Arriving",
    };
  }

  if (status.phase === "break" && status.phaseEndsAt) {
    const breakStart = status.phaseEndsAt - 10 * 60;
    const breakPrefix = `${prefix}-break-${status.cycle}`;
    if (stableHash(`${breakPrefix}-chance`) % 100 >= 30) {
      return { ...absent, present: true, status: "On recess" };
    }

    const duration = 60 + (stableHash(`${breakPrefix}-duration`) % 421);
    const latestLeave = status.phaseEndsAt - duration - 15;
    const leaveAt =
      breakStart +
      10 +
      (stableHash(`${breakPrefix}-leave`) % Math.max(1, latestLeave - breakStart - 9));
    const returnAt = leaveAt + duration;

    if (now < leaveAt) return { ...absent, present: true, status: "On recess" };
    if (now < leaveAt + 15) {
      return {
        present: true,
        transition: "leaving",
        transitionKey: `${breakPrefix}-leaving`,
        status: "Leaving",
      };
    }
    if (now < returnAt) return { ...absent, status: "Away" };
    if (now < returnAt + 15) {
      return {
        present: true,
        transition: "entering",
        transitionKey: `${breakPrefix}-returning`,
        status: "Returning",
      };
    }
    return { ...absent, present: true, status: "On recess" };
  }

  return { ...absent, present: true, status: "Teaching" };
}

function getDemoTeacherSchedule(
  scenario: DemoScenario,
  elapsed: number,
  run: number,
): TeacherSchedule {
  const base: TeacherSchedule = {
    present: true,
    transition: "none",
    transitionKey: `demo-${run}-teacher`,
    status: scenario === "recess" ? "On recess" : "Teaching",
  };
  if (scenario === "arrival" && elapsed < 12) {
    return {
      ...base,
      transition: "entering",
      transitionKey: `demo-${run}-teacher-arrival`,
      status: "Arriving",
    };
  }
  if (scenario !== "recess") return base;
  if (elapsed < 1) return { ...base, status: "On recess" };
  if (elapsed < 11) {
    return {
      ...base,
      transition: "leaving",
      transitionKey: `demo-${run}-teacher-leaving`,
      status: "Leaving",
    };
  }
  if (elapsed < 18) return { ...base, present: false, status: "Away" };
  if (elapsed < 30) {
    return {
      ...base,
      transition: "entering",
      transitionKey: `demo-${run}-teacher-returning`,
      status: "Returning",
    };
  }
  return { ...base, status: "On recess" };
}

function Box({
  position,
  scale,
  color,
  roughness = 0.7,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  roughness?: number;
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={scale} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

function Desk({
  position,
  teacher = false,
}: {
  position: [number, number, number];
  teacher?: boolean;
}) {
  const width = teacher ? 2.65 : 1.65;
  const depth = teacher ? 0.95 : 0.78;
  const topColor = teacher ? "#eeeae1" : oak;
  const xLeg = width / 2 - 0.13;
  const zLeg = depth / 2 - 0.12;

  return (
    <group position={position}>
      <RoundedBox
        args={[width, 0.13, depth]}
        radius={0.08}
        smoothness={3}
        position={[0, 1.18, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={topColor} roughness={0.58} />
      </RoundedBox>
      {[
        [-xLeg, zLeg],
        [xLeg, zLeg],
        [-xLeg, -zLeg],
        [xLeg, -zLeg],
      ].map(([x, z], index) => (
        <Box key={index} position={[x, 0.58, z]} scale={[0.07, 1.12, 0.07]} color={darkMetal} />
      ))}
      <Box position={[0, 0.35, -zLeg]} scale={[width - 0.18, 0.07, 0.07]} color={darkMetal} />
      {teacher && (
        <>
          <RoundedBox args={[0.74, 0.07, 0.52]} radius={0.04} position={[0.58, 1.27, 0]} castShadow>
            <meshStandardMaterial color="#252a2a" roughness={0.4} />
          </RoundedBox>
          <Box position={[-0.75, 1.3, 0.02]} scale={[0.34, 0.1, 0.28]} color="#e1d7c7" />
        </>
      )}
    </group>
  );
}

function Chair({
  position,
  teacher = false,
}: {
  position: [number, number, number];
  teacher?: boolean;
}) {
  const color = "#242725";
  return (
    <group position={position}>
      <RoundedBox
        args={[teacher ? 0.9 : 0.72, 0.12, 0.64]}
        radius={0.08}
        position={[0, 0.72, 0]}
        castShadow
      >
        <meshStandardMaterial color={color} roughness={0.75} />
      </RoundedBox>
      <RoundedBox
        args={[teacher ? 0.9 : 0.72, 0.72, 0.12]}
        radius={0.08}
        position={[0, 1.19, 0.27]}
        castShadow
      >
        <meshStandardMaterial color={color} roughness={0.72} />
      </RoundedBox>
      {[-0.28, 0.28].flatMap((x) =>
        [-0.22, 0.22].map((z, i) => (
          <Box
            key={`${x}-${i}`}
            position={[x, 0.34, z]}
            scale={[0.055, 0.68, 0.055]}
            color="#171918"
          />
        )),
      )}
      <Box position={[0, 0.26, 0.27]} scale={[0.65, 0.055, 0.055]} color="#171918" />
    </group>
  );
}

function StudentStation({ x, z }: { x: number; z: number }) {
  return (
    <group>
      <Desk position={[x, 0, z]} />
      <Chair position={[x, 0, z + 0.88]} />
    </group>
  );
}

function CeilingLight({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Box position={[0, 0, 0]} scale={[1.55, 0.09, 0.58]} color="#f5f3ed" />
      <rectAreaLight
        position={[0, -0.08, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        args={["#fff7df", 3.5, 1.45, 0.5]}
      />
    </group>
  );
}

function BackWindows() {
  return (
    <group position={[0, 2.55, -6.88]}>
      <Box position={[0, 0, 0]} scale={[6.2, 2.15, 0.12]} color="#1d2425" />
      {[-2.02, 0, 2.02].map((x) => (
        <group key={x}>
          <Box position={[x, 0, 0.07]} scale={[1.85, 1.82, 0.08]} color="#263133" roughness={0.2} />
          <Box position={[x, 0, 0.14]} scale={[0.06, 1.84, 0.05]} color="#0f1212" />
          <Box position={[x, 0, 0.14]} scale={[1.86, 0.06, 0.05]} color="#0f1212" />
        </group>
      ))}
    </group>
  );
}

function GlassWall() {
  return (
    <group position={[-5.42, 2.35, 0]}>
      <Box position={[0, 0, 0]} scale={[0.12, 4.7, 13.7]} color="#cfd4cf" />
      {[-4.55, 0, 4.55].map((z) => (
        <Box key={z} position={[0.08, 0, z]} scale={[0.07, 4.45, 0.08]} color="#f4f2ea" />
      ))}
      <Box position={[0.08, 0.2, 0]} scale={[0.07, 0.08, 13.4]} color="#f4f2ea" />
      <Box position={[0.13, 0.2, 0]} scale={[0.02, 2.2, 13.3]} color="#b8d7d2" roughness={0.15} />
    </group>
  );
}

function ClassroomDoor({
  z,
  label,
  color,
  open = false,
}: {
  z: number;
  label: string;
  color: string;
  open?: boolean;
}) {
  const door = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (door.current) {
      door.current.rotation.y = THREE.MathUtils.damp(
        door.current.rotation.y,
        open ? -Math.PI / 2 : 0,
        7,
        delta,
      );
    }
  });

  return (
    <group position={[-5.27, 0, z]}>
      <Box position={[0, 1.48, 0]} scale={[0.2, 2.86, 1.55]} color="#353531" />
      <group ref={door} position={[0, 0, -0.65]}>
        <RoundedBox
          args={[0.12, 2.58, 1.3]}
          radius={0.035}
          position={[0.12, 1.43, 0.65]}
          castShadow
        >
          <meshStandardMaterial color={color} roughness={0.72} />
        </RoundedBox>
        <Box
          position={[0.21, 1.65, 0.65]}
          scale={[0.035, 0.74, 0.72]}
          color="#b7d1ce"
          roughness={0.18}
        />
        <Box position={[0.23, 0.34, 0.65]} scale={[0.045, 0.055, 1.05]} color="#252724" />
        <mesh position={[0.24, 1.15, 1.08]} castShadow>
          <sphereGeometry args={[0.075, 18, 18]} />
          <meshStandardMaterial color="#d2b16b" metalness={0.45} roughness={0.3} />
        </mesh>
        <Text
          position={[0.225, 2.45, 0.65]}
          rotation={[0, Math.PI / 2, 0]}
          fontSize={0.12}
          color="#eee7dc"
          anchorX="center"
        >
          {label}
        </Text>
      </group>
    </group>
  );
}

function getSeoulTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    hours: value("hour"),
    minutes: value("minute"),
    seconds: value("second"),
    dateKey: `${value("year")}-${String(value("month")).padStart(2, "0")}-${String(value("day")).padStart(2, "0")}`,
  };
}

function ClassroomClock({
  mode,
  time,
  onFocus,
}: {
  mode: ClockMode;
  time: ReturnType<typeof getSeoulTime>;
  onFocus: () => void;
}) {
  const hourAngle = ((time.hours % 12) + time.minutes / 60) * (Math.PI / 6);
  const minuteAngle = (time.minutes + time.seconds / 60) * (Math.PI / 30);
  const secondAngle = time.seconds * (Math.PI / 30);
  const digitalTime = [time.hours, time.minutes, time.seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return (
    <group
      position={[0, 3.78, -6.76]}
      onClick={(event) => {
        event.stopPropagation();
        onFocus();
      }}
    >
      {mode === "analog" ? (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.62, 0.14, 48]} />
            <meshStandardMaterial color="#332b26" roughness={0.62} />
          </mesh>
          <mesh position={[0, 0, 0.09]}>
            <circleGeometry args={[0.53, 48]} />
            <meshStandardMaterial color="#eee8dc" roughness={0.74} />
          </mesh>
          {Array.from({ length: 12 }).map((_, index) => {
            const angle = (index / 12) * Math.PI * 2;
            return (
              <Box
                key={index}
                position={[Math.sin(angle) * 0.43, Math.cos(angle) * 0.43, 0.12]}
                scale={[index % 3 === 0 ? 0.035 : 0.02, index % 3 === 0 ? 0.09 : 0.06, 0.018]}
                color="#51483f"
              />
            );
          })}
          <group rotation={[0, 0, -hourAngle]}>
            <Box position={[0, 0.13, 0.145]} scale={[0.045, 0.27, 0.025]} color="#342e29" />
          </group>
          <group rotation={[0, 0, -minuteAngle]}>
            <Box position={[0, 0.19, 0.16]} scale={[0.032, 0.39, 0.022]} color="#342e29" />
          </group>
          <group rotation={[0, 0, -secondAngle]}>
            <Box position={[0, 0.19, 0.18]} scale={[0.018, 0.4, 0.016]} color="#bd5c48" />
          </group>
          <mesh position={[0, 0, 0.2]}>
            <sphereGeometry args={[0.055, 14, 14]} />
            <meshStandardMaterial color="#bd5c48" />
          </mesh>
        </group>
      ) : (
        <group>
          <RoundedBox args={[1.8, 0.72, 0.15]} radius={0.12} castShadow>
            <meshStandardMaterial color="#262422" roughness={0.48} />
          </RoundedBox>
          <Text
            position={[0, 0.06, 0.1]}
            fontSize={0.34}
            color="#f0b978"
            anchorX="center"
            anchorY="middle"
          >
            {digitalTime}
          </Text>
          <Text
            position={[0, -0.24, 0.1]}
            fontSize={0.09}
            color="#9dbeb5"
            anchorX="center"
            anchorY="middle"
          >
            SEOUL · KST
          </Text>
        </group>
      )}
    </group>
  );
}

type TeacherGoal = {
  key: string;
  point: THREE.Vector3;
  facing: number;
  laneZ?: number;
};

function TeacherSprite({
  deskX,
  schedule,
  classStatus,
  goal,
  speed,
}: {
  deskX: number;
  schedule: TeacherSchedule;
  classStatus: ClassStatus;
  goal: TeacherGoal;
  speed: number;
}) {
  const group = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const walkPhase = useRef(0);
  const routeStep = useRef(0);
  const route = useRef<THREE.Vector3[]>([goal.point]);
  const lastLaneZ = useRef<number | undefined>(undefined);
  const [walking, setWalking] = useState(false);
  const doorPosition = new THREE.Vector3(-4.32, 0, -4.9);
  const deskPosition = new THREE.Vector3(deskX, 0, -5.55);
  const routePoint = new THREE.Vector3(-4.6, 0, -5.75);
  const question = goldenQuestions[classStatus.questionId];
  const showingSolution = classStatus.phase === "golden" && classStatus.goldenStage === "solution";
  const showCard = classStatus.phase === "golden" && !walking && schedule.transition === "none";
  const settled = !walking && schedule.transition === "none";
  const lesson = classStatus.phase === "lesson" ? classStatus.lesson : idleLesson;
  const explaining = lesson.mode === "explain" && settled;
  const holdingPen = lesson.mode === "marking" && schedule.transition === "none";
  const markingNow = holdingPen && settled && goal.laneZ !== undefined;

  useEffect(() => {
    routeStep.current = 0;
    const current = group.current?.position.clone() ?? deskPosition;
    if (schedule.transition === "entering") {
      group.current?.position.copy(doorPosition);
      route.current = [routePoint, deskPosition];
    } else if (schedule.transition === "leaving") {
      route.current = [...planTeacherRoute(current, routePoint, lastLaneZ.current), doorPosition];
    } else {
      route.current = planTeacherRoute(current, goal.point, lastLaneZ.current);
    }
    lastLaneZ.current = schedule.transition === "none" ? goal.laneZ : undefined;
    if (schedule.transition !== "none" || current.distanceTo(goal.point) > 0.05) setWalking(true);
  }, [schedule.transition, schedule.transitionKey, goal.key]);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    const position = group.current.position;
    const path = route.current;
    const target = path[Math.min(routeStep.current, path.length - 1)];
    const direction = new THREE.Vector3(target.x - position.x, 0, target.z - position.z);
    const distance = direction.length();
    if (distance < 0.04 && routeStep.current < path.length - 1) {
      routeStep.current += 1;
      return;
    }
    const isWalking = distance > 0.025;
    let facing = schedule.transition === "leaving" ? Math.PI / 2 : goal.facing;

    if (isWalking) {
      direction.normalize();
      const step = Math.min(distance, speed * delta);
      position.x += direction.x * step;
      position.z += direction.z * step;
      facing = Math.atan2(-direction.x, -direction.z);
      walkPhase.current += delta * speed * 5.8;
    } else {
      position.x = target.x;
      position.z = target.z;
    }

    const turn = facing - group.current.rotation.y;
    group.current.rotation.y +=
      Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-7 * delta));
    const stride = isWalking ? Math.sin(walkPhase.current) * 0.52 : 0;
    position.y = THREE.MathUtils.damp(
      position.y,
      isWalking ? Math.abs(Math.sin(walkPhase.current)) * 0.03 : 0,
      14,
      delta,
    );
    if (leftLeg.current)
      leftLeg.current.rotation.x = THREE.MathUtils.damp(
        leftLeg.current.rotation.x,
        stride,
        13,
        delta,
      );
    if (rightLeg.current)
      rightLeg.current.rotation.x = THREE.MathUtils.damp(
        rightLeg.current.rotation.x,
        -stride,
        13,
        delta,
      );
    if (leftArm.current)
      leftArm.current.rotation.x = THREE.MathUtils.damp(
        leftArm.current.rotation.x,
        explaining && !isWalking ? 1.05 : -stride * 0.65,
        11,
        delta,
      );
    if (rightArm.current) {
      const time = clock.elapsedTime;
      // Small pen strokes: writing on the iPad, or ticking a textbook at a desk.
      const writing = Math.sin(time * 7.5) * 0.08 + Math.sin(time * 2.3) * 0.05;
      rightArm.current.rotation.x = THREE.MathUtils.damp(
        rightArm.current.rotation.x,
        showingSolution && !isWalking
          ? -1.15
          : explaining && !isWalking
            ? 0.95 + writing
            : markingNow && !isWalking
              ? 0.62 + writing
              : stride * 0.65,
        9,
        delta,
      );
    }
    if (walking !== isWalking) setWalking(isWalking);
  });

  return (
    <group
      ref={group}
      visible={schedule.present}
      position={schedule.transition === "entering" ? [-4.32, 0, -4.9] : [deskX, 0, -5.55]}
      rotation={[0, Math.PI, 0]}
    >
      {[-0.16, 0.16].map((x) => (
        <group key={x} ref={x < 0 ? leftLeg : rightLeg} position={[x, 1.02, 0]}>
          <mesh position={[0, -0.48, 0]} castShadow>
            <cylinderGeometry args={[0.095, 0.11, 0.96, 12]} />
            <meshStandardMaterial color="#2f3a42" roughness={0.78} />
          </mesh>
          <mesh position={[0, -0.96, -0.07]} castShadow>
            <boxGeometry args={[0.18, 0.08, 0.29]} />
            <meshStandardMaterial color="#17191a" roughness={0.7} />
          </mesh>
        </group>
      ))}
      <RoundedBox args={[0.7, 0.86, 0.42]} radius={0.17} position={[0, 1.48, 0]} castShadow>
        <meshStandardMaterial color="#7d8d83" roughness={0.8} />
      </RoundedBox>
      <Box position={[0, 1.55, -0.218]} scale={[0.18, 0.62, 0.025]} color="#e8e1d5" />
      {[-0.43, 0.43].map((x) => (
        <group key={x} ref={x < 0 ? leftArm : rightArm} position={[x, 1.84, 0]}>
          <mesh position={[0, -0.39, 0]} castShadow>
            <cylinderGeometry args={[0.075, 0.085, 0.76, 10]} />
            <meshStandardMaterial color="#c79b78" roughness={0.78} />
          </mesh>
          {x > 0 && (holdingPen || explaining) && (
            <mesh position={[0, -0.8, -0.02]} castShadow>
              <cylinderGeometry args={[0.016, 0.012, 0.22, 8]} />
              <meshStandardMaterial color={holdingPen ? "#c8372d" : "#d9d9d6"} roughness={0.45} />
            </mesh>
          )}
        </group>
      ))}
      {explaining && (
        // iPad held at chest height; its screen is mirrored onto the projector.
        <group position={[-0.1, 1.44, -0.62]} rotation={[-0.95, 0.1, 0]}>
          <RoundedBox args={[0.5, 0.36, 0.025]} radius={0.02} castShadow>
            <meshStandardMaterial color="#2a2d30" roughness={0.35} />
          </RoundedBox>
          <mesh position={[0, 0, 0.014]}>
            <planeGeometry args={[0.45, 0.31]} />
            <meshStandardMaterial
              color="#f6f3ea"
              emissive="#fdf8ec"
              emissiveIntensity={0.55}
              roughness={0.3}
            />
          </mesh>
        </group>
      )}
      <mesh position={[0, 2.18, 0]} castShadow>
        <sphereGeometry args={[0.33, 22, 18]} />
        <meshStandardMaterial color="#c79b78" roughness={0.75} />
      </mesh>
      <mesh position={[0, 2.29, 0.035]} scale={[1.06, 0.62, 1.04]} castShadow>
        <sphereGeometry args={[0.34, 18, 12]} />
        <meshStandardMaterial color="#3a2d27" roughness={0.9} />
      </mesh>
      {[-0.12, 0.12].map((x) => (
        <mesh key={x} position={[x, 2.2, -0.31]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.065, 0.012, 8, 18]} />
          <meshStandardMaterial color="#242424" roughness={0.45} />
        </mesh>
      ))}
      <Box position={[0, 2.2, -0.315]} scale={[0.09, 0.012, 0.012]} color="#242424" />
      {showCard && (
        <group position={[0, 2.82, -0.48]} rotation={[0, Math.PI, 0]}>
          <RoundedBox args={[0.94, 0.56, 0.04]} radius={0.04} castShadow>
            <meshStandardMaterial color="#f0c35e" roughness={0.5} />
          </RoundedBox>
          <Text position={[0, 0.12, 0.03]} fontSize={0.13} color="#3b2c1c" anchorX="center">
            {showingSolution ? "SOLUTION" : `Q${classStatus.questionIndex + 1}`}
          </Text>
          <Text
            position={[0, -0.09, 0.03]}
            fontSize={0.055}
            maxWidth={0.8}
            textAlign="center"
            color="#3b2c1c"
            anchorX="center"
          >
            {showingSolution ? `Answer: ${question.answer}` : question.prompt}
          </Text>
        </group>
      )}
      {showingSolution && showCard && (
        <mesh position={[0.62, 2.02, -0.42]} rotation={[-0.5, 0, 0.75]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 1.15, 8]} />
          <meshStandardMaterial color="#5b4636" roughness={0.65} />
        </mesh>
      )}
    </group>
  );
}

function StudentSprite({
  id,
  station,
  command,
  schedule,
  selected,
  canUseDoor,
  onSelect,
  onDoorToggle,
}: {
  id: number;
  station: { x: number; z: number };
  command: StudentCommand;
  schedule: StudentSchedule;
  selected: boolean;
  canUseDoor: boolean;
  onSelect: (id: number) => void;
  onDoorToggle: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const operatedDoor = useRef(false);
  const selectionArrow = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const walkPhase = useRef(id * 0.7);
  const [moving, setMoving] = useState(false);
  const shirtColors = ["#be694f", "#4f7d78", "#d29a48", "#6878a5", "#9b6684", "#6f8c58"];
  const skinColors = ["#70452f", "#9a6345", "#c1845f", "#dfa982", "#8b543b", "#bb7957"];
  const doorZ = schedule.door === "student" ? 5.05 : -4.9;
  const target =
    schedule.transition === "leaving"
      ? new THREE.Vector3(-4.32, 0, doorZ)
      : command.action === "door"
        ? new THREE.Vector3(-4.35, 0, 5.05)
        : new THREE.Vector3(station.x, 0, station.z + 0.88);
  const seated = command.action === "seated" && schedule.transition === "none" && !moving;
  const pitching = command.action === "standing" && schedule.transition === "none" && !moving;
  const headY = seated ? 1.58 : 1.86;

  useEffect(() => {
    operatedDoor.current = false;
    setMoving(true);
  }, [command.commandId, command.action, station.x, station.z]);

  useEffect(() => {
    if (!group.current) return;
    if (schedule.transition === "entering") {
      group.current.position.set(-4.32, 0, doorZ);
      setMoving(true);
    }
    if (schedule.transition === "leaving") setMoving(true);
  }, [doorZ, schedule.transition, schedule.transitionKey]);

  useFrame(({ clock }, delta) => {
    if (selectionArrow.current) {
      const time = clock.elapsedTime;
      selectionArrow.current.position.y = headY + 0.98 + Math.sin(time * 3.2) * 0.075;
      selectionArrow.current.rotation.y += delta * 1.8;
    }
    if (!group.current) return;
    const position = group.current.position;
    const direction = new THREE.Vector3(target.x - position.x, 0, target.z - position.z);
    const distance = direction.length();
    const walking = distance > 0.025;
    // Constant, slower locomotion reads as walking rather than sliding into place.
    const walkSpeed = 1.1;
    let facing = command.action === "door" || schedule.transition === "leaving" ? Math.PI / 2 : 0;

    if (walking) {
      direction.normalize();
      const step = Math.min(distance, walkSpeed * delta);
      position.x += direction.x * step;
      position.z += direction.z * step;
      facing = Math.atan2(-direction.x, -direction.z);
      walkPhase.current += delta * walkSpeed * 6.4;
    } else {
      position.x = target.x;
      position.z = target.z;
    }

    const turn = facing - group.current.rotation.y;
    group.current.rotation.y +=
      Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-8 * delta));
    const stride = walking ? Math.sin(walkPhase.current) * 0.62 : 0;
    position.y = THREE.MathUtils.damp(
      position.y,
      walking ? Math.abs(Math.sin(walkPhase.current)) * 0.035 : 0,
      14,
      delta,
    );
    if (leftLeg.current) {
      leftLeg.current.rotation.x = THREE.MathUtils.damp(
        leftLeg.current.rotation.x,
        stride,
        14,
        delta,
      );
    }
    if (rightLeg.current) {
      rightLeg.current.rotation.x = THREE.MathUtils.damp(
        rightLeg.current.rotation.x,
        -stride,
        14,
        delta,
      );
    }
    if (leftArm.current) {
      leftArm.current.rotation.x = THREE.MathUtils.damp(
        leftArm.current.rotation.x,
        -stride * 0.72,
        12,
        delta,
      );
    }
    if (rightArm.current && !pitching) {
      rightArm.current.rotation.x = THREE.MathUtils.damp(
        rightArm.current.rotation.x,
        stride * 0.72,
        12,
        delta,
      );
    }

    if (!walking && moving) setMoving(false);
    if (command.action === "door" && distance < 0.16 && !operatedDoor.current && canUseDoor) {
      operatedDoor.current = true;
      onDoorToggle();
    }
  });

  return (
    <group
      ref={group}
      visible={schedule.present}
      position={
        schedule.present && schedule.transition === "entering"
          ? [-4.32, 0, doorZ]
          : [station.x, 0, station.z + 0.88]
      }
      onClick={(event) => {
        event.stopPropagation();
        onSelect(id);
      }}
    >
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.055, 0]} visible={selected}>
        <torusGeometry args={[0.48, 0.045, 10, 36]} />
        <meshBasicMaterial color="#f0b66f" toneMapped={false} />
      </mesh>

      {seated ? (
        <>
          {[-0.14, 0.14].map((x) => (
            <group key={x}>
              <mesh position={[x, 0.76, -0.18]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.085, 0.09, 0.45, 10]} />
                <meshStandardMaterial color="#343d50" roughness={0.8} />
              </mesh>
              <mesh position={[x, 0.43, -0.39]} castShadow>
                <cylinderGeometry args={[0.075, 0.085, 0.48, 10]} />
                <meshStandardMaterial color="#343d50" roughness={0.8} />
              </mesh>
            </group>
          ))}
          {[-0.27, 0.27].map((x) => (
            <mesh key={x} position={[x, 1.24, -0.35]} rotation={[Math.PI / 2.8, 0, 0]} castShadow>
              <cylinderGeometry args={[0.065, 0.075, 0.58, 10]} />
              <meshStandardMaterial color={skinColors[id % skinColors.length]} roughness={0.8} />
            </mesh>
          ))}
          {schedule.activity === "golden" ? (
            <group
              position={schedule.showBoard ? [0, 2.12, -0.42] : [0, 1.28, -0.78]}
              rotation={schedule.showBoard ? [0, 0, 0] : [-Math.PI / 2, 0, 0]}
            >
              <RoundedBox args={[0.78, 0.5, 0.035]} radius={0.035} castShadow>
                <meshStandardMaterial color="#f8f7ef" roughness={0.42} />
              </RoundedBox>
              <Box position={[0, 0, 0]} scale={[0.82, 0.54, 0.02]} color="#2f3836" />
              <Text
                position={[0, 0, -0.03]}
                rotation={[0, Math.PI, 0]}
                fontSize={schedule.showBoard ? 0.15 : 0.11}
                color="#25302e"
                anchorX="center"
                anchorY="middle"
              >
                {schedule.showBoard ? schedule.answer : "..."}
              </Text>
              <Text
                position={[0, 0, 0.03]}
                fontSize={schedule.showBoard ? 0.15 : 0.11}
                color="#25302e"
                anchorX="center"
                anchorY="middle"
              >
                {schedule.showBoard ? schedule.answer : "..."}
              </Text>
            </group>
          ) : schedule.activity === "snack" ? (
            <group position={[0, 1.27, -0.76]}>
              <RoundedBox
                args={[0.34, 0.12, 0.25]}
                radius={0.04}
                rotation={[0, 0.25, 0]}
                castShadow
              >
                <meshStandardMaterial color="#d9784f" roughness={0.65} />
              </RoundedBox>
              <mesh position={[0.32, 0.09, 0.02]} castShadow>
                <cylinderGeometry args={[0.075, 0.065, 0.24, 18]} />
                <meshStandardMaterial color="#7bb7aa" roughness={0.45} />
              </mesh>
              <mesh position={[-0.28, 0.035, 0.04]} castShadow>
                <cylinderGeometry args={[0.12, 0.12, 0.035, 20]} />
                <meshStandardMaterial color="#f1ded0" roughness={0.6} />
              </mesh>
            </group>
          ) : schedule.activity === "lesson" ? (
            <group position={[0, 1.255, -0.8]}>
              <Box position={[0, 0.006, 0]} scale={[0.6, 0.012, 0.42]} color="#b75b45" />
              {[-0.145, 0.145].map((x) => (
                <group key={x} position={[x, 0.02, 0]} rotation={[0, 0, x < 0 ? 0.035 : -0.035]}>
                  <Box position={[0, 0, 0]} scale={[0.28, 0.018, 0.39]} color="#f3ead6" />
                  {[-0.11, -0.05, 0.01, 0.07].map((z) => (
                    <Box
                      key={z}
                      position={[-0.01, 0.011, z]}
                      scale={[0.2, 0.003, 0.012]}
                      color={x < 0 ? "#b9ad98" : "#8f8676"}
                    />
                  ))}
                </group>
              ))}
              {schedule.marking === "current" && (
                <Box position={[0.145, 0.034, 0.13]} scale={[0.24, 0.004, 0.06]} color="#f0c35e" />
              )}
              {schedule.marking === "marked" &&
                (schedule.markCorrect ? (
                  <group position={[0.15, 0.036, 0.1]} scale={1.3}>
                    {[
                      { x: -0.0325, z: 0.0175, length: 0.055, angle: 0.785 },
                      { x: 0.0225, z: -0.0125, length: 0.125, angle: 2.47 },
                    ].map((stroke) => (
                      <group
                        key={stroke.angle}
                        position={[stroke.x, 0, stroke.z]}
                        rotation={[0, stroke.angle, 0]}
                      >
                        <Box
                          position={[0, 0, 0]}
                          scale={[0.02, 0.004, stroke.length]}
                          color="#d0372b"
                          roughness={0.4}
                        />
                      </group>
                    ))}
                  </group>
                ) : (
                  <group position={[0.16, 0.036, 0.12]}>
                    {[0.75, -0.75].map((angle) => (
                      <group key={angle} rotation={[0, angle, 0]}>
                        <Box
                          position={[0, 0, 0]}
                          scale={[0.022, 0.005, 0.12]}
                          color="#d0372b"
                          roughness={0.4}
                        />
                      </group>
                    ))}
                  </group>
                ))}
            </group>
          ) : null}
        </>
      ) : (
        <>
          {[-0.14, 0.14].map((x) => (
            <group key={x} ref={x < 0 ? leftLeg : rightLeg} position={[x, 0.9, 0]}>
              <mesh position={[0, -0.42, 0]} castShadow>
                <cylinderGeometry args={[0.09, 0.105, 0.85, 10]} />
                <meshStandardMaterial color="#343d50" roughness={0.8} />
              </mesh>
              <mesh position={[0, -0.84, -0.06]} castShadow>
                <boxGeometry args={[0.16, 0.07, 0.25]} />
                <meshStandardMaterial color="#202326" roughness={0.75} />
              </mesh>
            </group>
          ))}
          {pitching ? (
            <mesh position={[0.36, 1.66, 0]} rotation={[0, 0, -0.25]} castShadow>
              <cylinderGeometry args={[0.065, 0.075, 0.9, 10]} />
              <meshStandardMaterial color={skinColors[id % skinColors.length]} roughness={0.8} />
            </mesh>
          ) : (
            <group ref={rightArm} position={[0.36, 1.56, 0]}>
              <mesh position={[0, -0.34, 0]} rotation={[0, 0, -0.05]} castShadow>
                <cylinderGeometry args={[0.065, 0.075, 0.68, 10]} />
                <meshStandardMaterial color={skinColors[id % skinColors.length]} roughness={0.8} />
              </mesh>
            </group>
          )}
          <group ref={leftArm} position={[-0.36, 1.56, 0]}>
            <mesh position={[0, -0.36, 0]} rotation={[0, 0, 0.05]} castShadow>
              <cylinderGeometry args={[0.065, 0.075, 0.68, 10]} />
              <meshStandardMaterial color={skinColors[id % skinColors.length]} roughness={0.8} />
            </mesh>
          </group>
        </>
      )}

      <RoundedBox
        args={[0.58, 0.68, 0.38]}
        radius={0.16}
        position={[0, seated ? 1.22 : 1.24, 0]}
        castShadow
      >
        <meshStandardMaterial color={shirtColors[id % shirtColors.length]} roughness={0.78} />
      </RoundedBox>
      <mesh position={[0, headY, 0]} castShadow>
        <sphereGeometry args={[0.28, 18, 14]} />
        <meshStandardMaterial color={skinColors[id % skinColors.length]} roughness={0.78} />
      </mesh>
      <mesh position={[0, headY + 0.1, 0.015]} scale={[1.04, 0.72, 1.04]} castShadow>
        <sphereGeometry args={[0.29, 14, 10]} />
        <meshStandardMaterial
          color={id % 3 === 0 ? "#352a26" : id % 3 === 1 ? "#1f2020" : "#6a452e"}
          roughness={0.9}
        />
      </mesh>
      <mesh position={[0, headY, -0.275]}>
        <sphereGeometry args={[0.045, 10, 10]} />
        <meshStandardMaterial color={skinColors[id % skinColors.length]} />
      </mesh>
      {selected && (
        <>
          <group ref={selectionArrow} position={[0, headY + 0.98, 0]}>
            <mesh position={[0, 0.16, 0]} castShadow>
              <boxGeometry args={[0.105, 0.24, 0.105]} />
              <meshStandardMaterial
                color="#75d66b"
                emissive="#38a843"
                emissiveIntensity={0.85}
                roughness={0.32}
              />
            </mesh>
            <mesh position={[0, -0.09, 0]} rotation={[Math.PI, 0, 0]} castShadow>
              <coneGeometry args={[0.22, 0.34, 4]} />
              <meshStandardMaterial
                color="#8ce87b"
                emissive="#3fbd4b"
                emissiveIntensity={0.95}
                roughness={0.28}
              />
            </mesh>
            <pointLight position={[0, -0.12, 0]} color="#79e66d" intensity={1.4} distance={1.6} />
          </group>
          <Text
            position={[0, headY + 1.48, 0]}
            fontSize={0.18}
            color="#fff6e8"
            anchorX="center"
            outlineWidth={0.018}
            outlineColor="#2b211b"
          >
            {studentNames[id]}
          </Text>
        </>
      )}
    </group>
  );
}

function Classroom({
  swapped,
  allocation,
  studentDoor,
  doorOpen,
  teacherDoorOpen,
  commands,
  studentSchedules,
  selectedStudent,
  onSelectStudent,
  onDoorToggle,
  clockMode,
  clockTime,
  classStatus,
  teacherSchedule,
  markingStudent,
  teacherSpeed,
  onClockFocus,
  onSceneClick,
}: {
  swapped: boolean;
  allocation: Allocation;
  studentDoor: boolean;
  doorOpen: boolean;
  teacherDoorOpen: boolean;
  commands: StudentCommand[];
  studentSchedules: StudentSchedule[];
  selectedStudent: number;
  onSelectStudent: (id: number) => void;
  onDoorToggle: () => void;
  clockMode: ClockMode;
  clockTime: ReturnType<typeof getSeoulTime>;
  classStatus: ClassStatus;
  teacherSchedule: TeacherSchedule;
  markingStudent: number;
  teacherSpeed: number;
  onClockFocus: () => void;
  onSceneClick: () => void;
}) {
  const stations = getStations(allocation);
  const teacherDeskX = swapped ? -2.9 : 2.9;
  const teacherChairX = swapped ? -4.45 : 4.45;
  const question = goldenQuestions[classStatus.questionId];
  const showingSolution = classStatus.phase === "golden" && classStatus.goldenStage === "solution";
  const lesson = classStatus.phase === "lesson" ? classStatus.lesson : idleLesson;
  const projecting = lesson.mode !== "idle";
  const textbook = textbookProblems[lesson.problemId];
  const markedCount = Math.min(Math.max(lesson.visitIndex, 0), lesson.visitCount);
  const markingSpot =
    lesson.mode === "marking" && markingStudent >= 0
      ? getMarkingSpot(allocation, markingStudent)
      : null;
  const teacherGoal: TeacherGoal = markingSpot
    ? { key: `mark-${allocation}-${markingStudent}`, ...markingSpot }
    : {
        key: `desk-${teacherDeskX}`,
        point: new THREE.Vector3(teacherDeskX, 0, -5.55),
        facing: Math.PI,
      };
  const boardTitle =
    classStatus.phase === "golden"
      ? `GOLDEN BELL · Q${classStatus.questionIndex + 1}/${classStatus.questionCount} · LEVEL ${classStatus.difficulty}`
      : classStatus.phase === "break"
        ? "RECESS"
        : classStatus.phase === "lesson"
          ? `LESSON ${classStatus.cycle + 1}`
          : classStatus.phase === "arrival"
            ? `CLASS ${classStatus.session?.id}`
            : "CLASS NOTES";
  const boardMain =
    classStatus.phase === "golden"
      ? question.prompt
      : classStatus.phase === "break" && classStatus.returnBy
        ? `Back by ${formatSeconds(classStatus.returnBy)}`
        : classStatus.phase === "lesson"
          ? "Textbook practice"
          : classStatus.phase === "arrival" && classStatus.session
            ? `Starts ${formatSeconds(classStatus.session.startsAt)}`
            : "Next class soon";
  const boardSub =
    classStatus.phase === "golden"
      ? classStatus.goldenStage === "solution"
        ? `ANSWER: ${question.answer}`
        : classStatus.reveal
          ? "TIME · ALL BOARDS UP"
          : `${classStatus.difficulty} MIN WINDOW · ${formatDuration(
              classStatus.answerSeconds - classStatus.questionElapsed,
            )} LEFT`
      : classStatus.phase === "break"
        ? "Snack in class or step out"
        : classStatus.phaseEndsAt
          ? `Until ${formatSeconds(classStatus.phaseEndsAt)}`
          : "Seoul daily schedule";

  return (
    <group
      onClick={(event) => {
        // Ignore orbit drags; only a deliberate click outside the clock exits clock view.
        if (event.delta <= 4) onSceneClick();
      }}
    >
      <RoundedBox args={[11.25, 0.38, 14.2]} radius={0.24} position={[0, -0.24, 0]} receiveShadow>
        <meshStandardMaterial color="#65635e" roughness={0.9} />
      </RoundedBox>
      <Box position={[0, 0.005, 0]} scale={[10.75, 0.08, 13.7]} color="#918f88" />

      {Array.from({ length: 10 }).map((_, i) => (
        <Box
          key={i}
          position={[-4.8 + i * 1.08, 0.06, 0]}
          scale={[0.018, 0.012, 13.55]}
          color="#77756f"
        />
      ))}

      <Box position={[0, 2.45, -6.94]} scale={[11, 4.9, 0.18]} color={wall} />
      <GlassWall />
      <ClassroomDoor z={-4.9} label="TEACHER" color="#78513b" open={teacherDoorOpen} />
      {studentDoor && <ClassroomDoor z={5.05} label="STUDENTS" color="#476663" open={doorOpen} />}
      <BackWindows />
      <ClassroomClock mode={clockMode} time={clockTime} onFocus={onClockFocus} />

      <group position={[3.65, 2.25, -6.8]}>
        <RoundedBox args={[2.25, 1.35, 0.11]} radius={0.04}>
          <meshStandardMaterial color="#ecebe4" roughness={0.5} />
        </RoundedBox>
        <Box position={[0, -0.73, 0.03]} scale={[2.4, 0.08, 0.16]} color="#6d6a65" />
        {projecting ? (
          // The teacher's iPad is screen-shared to the projector, so the board shows the textbook.
          <group position={[0, 0, 0.062]}>
            <mesh>
              <planeGeometry args={[2.12, 1.22]} />
              <meshStandardMaterial
                color="#fbf7ee"
                emissive="#fff6e2"
                emissiveIntensity={0.42}
                roughness={0.9}
              />
            </mesh>
            <mesh position={[0, 0.535, 0.002]}>
              <planeGeometry args={[2.12, 0.15]} />
              <meshBasicMaterial color="#2b2f33" toneMapped={false} />
            </mesh>
            <mesh position={[-0.98, 0.535, 0.004]}>
              <circleGeometry args={[0.022, 16]} />
              <meshBasicMaterial color="#e05a47" toneMapped={false} />
            </mesh>
            <Text
              position={[-0.93, 0.535, 0.005]}
              fontSize={0.05}
              color="#d9d6cf"
              anchorX="left"
              anchorY="middle"
            >
              iPad · Screen mirroring
            </Text>
            <Text
              position={[0.98, 0.535, 0.005]}
              fontSize={0.05}
              color="#f0c35e"
              anchorX="right"
              anchorY="middle"
            >
              {`TEXTBOOK p.${textbook.page} · #${textbook.number}`}
            </Text>
            <Text
              position={[-0.96, 0.39, 0.005]}
              fontSize={0.078}
              maxWidth={1.92}
              lineHeight={1.2}
              color="#2f2b27"
              anchorX="left"
              anchorY="top"
            >
              {`${textbook.number}. ${textbook.prompt}`}
            </Text>
            {lesson.mode === "explain" ? (
              <>
                {textbook.steps.slice(0, lesson.stepsShown).map((step, index) => (
                  <Text
                    key={step}
                    position={[-0.88, 0.07 - index * 0.15, 0.005]}
                    fontSize={0.068}
                    maxWidth={1.8}
                    color="#2456a6"
                    anchorX="left"
                    anchorY="middle"
                  >
                    {step}
                  </Text>
                ))}
                {lesson.answerShown && (
                  <group position={[0.62, -0.44, 0.005]}>
                    <mesh>
                      <planeGeometry args={[0.68, 0.15]} />
                      <meshBasicMaterial color="#c8372d" toneMapped={false} />
                    </mesh>
                    <mesh position={[0, 0, 0.001]}>
                      <planeGeometry args={[0.65, 0.12]} />
                      <meshBasicMaterial color="#fbf3e6" toneMapped={false} />
                    </mesh>
                    <Text
                      position={[0, 0, 0.003]}
                      fontSize={0.065}
                      color="#c8372d"
                      anchorX="center"
                      anchorY="middle"
                    >
                      {textbook.answer}
                    </Text>
                  </group>
                )}
                <Text
                  position={[-0.96, -0.44, 0.005]}
                  fontSize={0.048}
                  color="#8a847b"
                  anchorX="left"
                  anchorY="middle"
                >
                  {`EXPLAINING TO THE CLASS · ${formatDuration(lesson.segmentRemaining)}`}
                </Text>
              </>
            ) : (
              <>
                <Text
                  position={[0, -0.06, 0.005]}
                  fontSize={0.1}
                  color="#2456a6"
                  anchorX="center"
                  anchorY="middle"
                >
                  {`Try #${textbook.number} in your textbook`}
                </Text>
                <mesh position={[-0.46, -0.44, 0.003]}>
                  <planeGeometry args={[1.0, 0.035]} />
                  <meshBasicMaterial color="#e3dccd" toneMapped={false} />
                </mesh>
                <mesh
                  position={[
                    -0.96 + (markedCount / Math.max(1, lesson.visitCount)) * 0.5,
                    -0.44,
                    0.004,
                  ]}
                >
                  <planeGeometry
                    args={[
                      Math.max(0.001, (markedCount / Math.max(1, lesson.visitCount)) * 1.0),
                      0.035,
                    ]}
                  />
                  <meshBasicMaterial color="#c8372d" toneMapped={false} />
                </mesh>
                <Text
                  position={[0.98, -0.44, 0.005]}
                  fontSize={0.048}
                  color="#8a847b"
                  anchorX="right"
                  anchorY="middle"
                >
                  {`MARKING · ${markedCount}/${lesson.visitCount} CHECKED`}
                </Text>
              </>
            )}
          </group>
        ) : (
          <>
            <Text
              position={[0, 0.39, 0.08]}
              fontSize={0.11}
              color={classStatus.phase === "golden" ? "#b8842f" : "#9b9a93"}
              anchorX="center"
            >
              {boardTitle}
            </Text>
            {showingSolution ? (
              <group position={[0, 0.03, 0.08]}>
                <Text position={[0, 0.24, 0]} fontSize={0.085} color="#a77a2f" anchorX="center">
                  EXEMPLARY SOLUTION
                </Text>
                {question.steps.map((step, index) => (
                  <Text
                    key={step}
                    position={[-0.92, 0.07 - index * 0.17, 0]}
                    fontSize={0.075}
                    maxWidth={1.82}
                    color="#3e3b37"
                    anchorX="left"
                    anchorY="middle"
                  >
                    {`${index + 1}. ${step}`}
                  </Text>
                ))}
              </group>
            ) : (
              <Text
                position={[0, 0.03, 0.08]}
                fontSize={classStatus.phase === "golden" ? 0.12 : 0.2}
                maxWidth={1.9}
                textAlign="center"
                color="#3e3b37"
                anchorX="center"
                anchorY="middle"
              >
                {boardMain}
              </Text>
            )}
            <Text position={[0, -0.39, 0.08]} fontSize={0.085} color="#7f7b75" anchorX="center">
              {boardSub}
            </Text>
          </>
        )}
      </group>

      <group position={[-3.9, 2.1, -6.79]}>
        <RoundedBox args={[1.75, 1.2, 0.12]} radius={0.04}>
          <meshStandardMaterial color="#273329" roughness={0.8} />
        </RoundedBox>
        <Text position={[0, 0.15, 0.08]} fontSize={0.25} color="#d4b66f" anchorX="center">
          WELCOME
        </Text>
        <Text position={[0, -0.22, 0.08]} fontSize={0.13} color="#d8d6c8" anchorX="center">
          make • learn • share
        </Text>
      </group>

      <Desk position={[teacherDeskX, 0, -4.75]} teacher />
      {projecting && lesson.mode !== "explain" && (
        // Left on the desk while marking; the textbook page stays mirrored to the projector.
        <group position={[teacherDeskX - 0.15, 1.262, -4.7]} rotation={[-Math.PI / 2, 0, 0.18]}>
          <RoundedBox args={[0.5, 0.36, 0.02]} radius={0.02} castShadow>
            <meshStandardMaterial color="#2a2d30" roughness={0.35} />
          </RoundedBox>
          <mesh position={[0, 0, 0.011]}>
            <planeGeometry args={[0.45, 0.31]} />
            <meshStandardMaterial color="#f6f3ea" emissive="#fdf8ec" emissiveIntensity={0.55} />
          </mesh>
        </group>
      )}
      <Chair position={[teacherChairX, 0, -4.75]} teacher />

      {stations.map(({ x, z }, index) => (
        <group key={index}>
          <StudentStation x={x} z={z} />
          <StudentSprite
            id={index}
            station={{ x, z }}
            command={commands[index]}
            schedule={studentSchedules[index]}
            selected={selectedStudent === index}
            canUseDoor={studentDoor}
            onSelect={onSelectStudent}
            onDoorToggle={onDoorToggle}
          />
        </group>
      ))}

      <TeacherSprite
        deskX={teacherDeskX}
        schedule={teacherSchedule}
        classStatus={classStatus}
        goal={teacherGoal}
        speed={teacherSpeed}
      />

      {[-3.1, 1.45, 5].map((z) => (
        <CeilingLight key={z} position={[0, 4.75, z]} />
      ))}
      <group position={[2.2, 4.48, -0.8]}>
        <Box position={[0, 0, 0]} scale={[0.7, 0.28, 0.42]} color="#eceae1" />
        <mesh position={[0, -0.08, -0.26]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.11, 0.16, 0.25, 20]} />
          <meshStandardMaterial color="#252a2a" />
        </mesh>
        <mesh position={[0, -0.08, -0.37]}>
          <sphereGeometry args={[0.085, 16, 12]} />
          <meshStandardMaterial
            color={projecting ? "#fff4d6" : "#1b1f20"}
            emissive={projecting ? "#fff1c8" : "#000000"}
            emissiveIntensity={projecting ? 1.6 : 0}
          />
        </mesh>
      </group>
    </group>
  );
}

function CameraRig({ view, swapped }: { view: ViewMode; swapped: boolean }) {
  const { camera } = useThree();
  const perspectiveCamera = camera as THREE.PerspectiveCamera;
  const controls = useRef<any>(null);

  useEffect(() => {
    if (view === "teacher") {
      perspectiveCamera.position.set(swapped ? -2.9 : 2.9, 2.08, -5.1);
      perspectiveCamera.fov = 58;
      controls.current?.target.set(0, 1.05, 2.5);
    } else if (view === "clock") {
      perspectiveCamera.position.set(0, 3.8, -3.7);
      perspectiveCamera.fov = 34;
      controls.current?.target.set(0, 3.78, -6.76);
    } else {
      perspectiveCamera.position.set(12.2, 10.5, 15.2);
      perspectiveCamera.fov = 38;
      controls.current?.target.set(0, 1.1, 0);
    }
    perspectiveCamera.updateProjectionMatrix();
    controls.current?.update();
  }, [perspectiveCamera, swapped, view]);

  return (
    <OrbitControls
      ref={controls}
      enableDamping
      dampingFactor={0.08}
      minDistance={view === "dollhouse" ? 10 : view === "teacher" ? 0.5 : 2}
      maxDistance={view === "dollhouse" ? 28 : view === "teacher" ? 11 : 8}
      maxPolarAngle={Math.PI / 2.05}
      minPolarAngle={view === "teacher" ? 0.85 : 0.35}
      enablePan={view === "dollhouse"}
    />
  );
}

function Scene({
  view,
  swapped,
  allocation,
  studentDoor,
  doorOpen,
  teacherDoorOpen,
  commands,
  studentSchedules,
  selectedStudent,
  onSelectStudent,
  onDoorToggle,
  clockMode,
  clockTime,
  classStatus,
  teacherSchedule,
  markingStudent,
  teacherSpeed,
  onClockFocus,
  onSceneClick,
}: {
  view: ViewMode;
  swapped: boolean;
  allocation: Allocation;
  studentDoor: boolean;
  doorOpen: boolean;
  teacherDoorOpen: boolean;
  commands: StudentCommand[];
  studentSchedules: StudentSchedule[];
  selectedStudent: number;
  onSelectStudent: (id: number) => void;
  onDoorToggle: () => void;
  clockMode: ClockMode;
  clockTime: ReturnType<typeof getSeoulTime>;
  classStatus: ClassStatus;
  teacherSchedule: TeacherSchedule;
  markingStudent: number;
  teacherSpeed: number;
  onClockFocus: () => void;
  onSceneClick: () => void;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [12.2, 10.5, 15.2], fov: 38, near: 0.1, far: 100 }}
      onPointerMissed={(event) => {
        if (event.type === "click") onSceneClick();
      }}
    >
      <color attach="background" args={["#171310"]} />
      <fog attach="fog" args={["#171310", 24, 44]} />
      <ambientLight intensity={1.25} color="#fff1dc" />
      <directionalLight
        position={[4, 11, 8]}
        intensity={2.2}
        color="#fff0d1"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <pointLight position={[-4, 4, -4]} intensity={14} distance={12} color="#d8f2ef" />
      <Classroom
        swapped={swapped}
        allocation={allocation}
        studentDoor={studentDoor}
        doorOpen={doorOpen}
        teacherDoorOpen={teacherDoorOpen}
        commands={commands}
        studentSchedules={studentSchedules}
        selectedStudent={selectedStudent}
        onSelectStudent={onSelectStudent}
        onDoorToggle={onDoorToggle}
        clockMode={clockMode}
        clockTime={clockTime}
        classStatus={classStatus}
        teacherSchedule={teacherSchedule}
        markingStudent={markingStudent}
        teacherSpeed={teacherSpeed}
        onClockFocus={onClockFocus}
        onSceneClick={onSceneClick}
      />
      <ContactShadows position={[0, -0.02, 0]} opacity={0.42} scale={22} blur={2.4} far={16} />
      <CameraRig view={view} swapped={swapped} />
    </Canvas>
  );
}

function ViewIcon({ mode }: { mode: ViewMode }) {
  return mode === "dollhouse" ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 8.2 9-5 9 5v8l-9 5-9-5zM12 13l9-4.8M12 13 3 8.2M12 13v8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.4-5.2 9.5-5.2S21.5 12 21.5 12s-3.4 5.2-9.5 5.2S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.3" />
    </svg>
  );
}

function PanelIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {expanded ? <path d="M6 12h12" /> : <path d="M7 10l5 5 5-5" />}
    </svg>
  );
}

function FocusIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {active ? (
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      ) : (
        <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />
      )}
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState<ViewMode>("dollhouse");
  const [viewBeforeClock, setViewBeforeClock] = useState<Exclude<ViewMode, "clock">>("dollhouse");
  const [swapped, setSwapped] = useState(false);
  const [allocation, setAllocation] = useState<Allocation>("4x3");
  const [studentDoor, setStudentDoor] = useState(true);
  const [doorOpen, setDoorOpen] = useState(false);
  const [clockMode, setClockMode] = useState<ClockMode>("digital");
  const [seoulTime, setSeoulTime] = useState(getSeoulTime);
  const [demoMode, setDemoMode] = useState(false);
  const [demoScenario, setDemoScenario] = useState<DemoScenario>("golden");
  const [demoRun, setDemoRun] = useState(0);
  const [demoStartedAt, setDemoStartedAt] = useState(() => Date.now());
  const [demoNow, setDemoNow] = useState(() => Date.now());
  const [demoStudentCount, setDemoStudentCount] = useState(maxStudents);
  const [studentCountDraft, setStudentCountDraft] = useState(String(maxStudents));
  const [selectedStudent, setSelectedStudent] = useState(0);
  const [panels, setPanels] = useState<PanelState>(getInitialPanelState);
  const [commands, setCommands] = useState<StudentCommand[]>(() =>
    Array.from({ length: 12 }, () => ({ action: "seated", commandId: 0 })),
  );
  const nowInSeconds = seoulTime.hours * 60 * 60 + seoulTime.minutes * 60 + seoulTime.seconds;
  const demoElapsed = Math.max(0, (demoNow - demoStartedAt) / 1000);
  const classStatus = demoMode
    ? getDemoStatus(demoScenario, demoElapsed, demoRun, demoStudentCount)
    : getClassStatus(nowInSeconds, seoulTime.dateKey);
  const activeSession = classStatus.session;
  const lesson = classStatus.phase === "lesson" ? classStatus.lesson : idleLesson;
  const visitOrder = getVisitOrder(
    allocation,
    Array.from({ length: demoMode ? demoStudentCount : maxStudents }, (_, id) => id),
  );
  const markingStudent =
    lesson.mode === "marking" && lesson.visitIndex < visitOrder.length
      ? visitOrder[lesson.visitIndex]
      : -1;
  const baseSchedules = Array.from({ length: 12 }, (_, studentId) =>
    demoMode
      ? getDemoStudentSchedule(
          studentId,
          demoScenario,
          demoElapsed,
          demoRun,
          studentDoor,
          classStatus,
          demoStudentCount,
        )
      : getStudentSchedule(studentId, nowInSeconds, seoulTime.dateKey, studentDoor, classStatus),
  );
  const studentSchedules = baseSchedules.map((schedule, studentId): StudentSchedule => {
    const position = visitOrder.indexOf(studentId);
    if (lesson.mode !== "marking" || position < 0 || schedule.activity !== "lesson")
      return schedule;
    const mathLevel = 0.35 + (stableHash(`student-${studentId}-math-level`) % 66) / 100;
    const markSeed = `${classStatus.phaseKey}-${lesson.round}-${studentId}-mark`;
    return {
      ...schedule,
      marking:
        position < lesson.visitIndex
          ? "marked"
          : position === lesson.visitIndex
            ? "current"
            : "waiting",
      markCorrect: (stableHash(markSeed) % 100) / 100 < 0.3 + mathLevel * 0.6,
    };
  });
  const teacherSchedule = demoMode
    ? getDemoTeacherSchedule(demoScenario, demoElapsed, demoRun)
    : getTeacherSchedule(nowInSeconds, seoulTime.dateKey, classStatus);
  const teacherActivity =
    teacherSchedule.status !== "Teaching" || lesson.mode === "idle"
      ? teacherSchedule.status
      : lesson.mode === "explain"
        ? "Explaining on iPad"
        : markingStudent >= 0
          ? `Marking ${studentNames[markingStudent]}'s textbook`
          : "Back to the desk";
  const teacherDoorTransitionOpen =
    teacherSchedule.transition !== "none" ||
    studentSchedules.some(
      (schedule) => schedule.transition !== "none" && schedule.door === "teacher",
    );
  const studentDoorTransitionOpen = studentSchedules.some(
    (schedule) => schedule.transition !== "none" && schedule.door === "student",
  );
  const selectedSchedule = studentSchedules[selectedStudent];
  const selectedStudentAvailable =
    selectedSchedule.present && selectedSchedule.transition === "none";
  const transitionSignature = studentSchedules
    .map((schedule) => (schedule.transition === "none" ? "" : schedule.transitionKey))
    .join("|");
  const previousPhase = useRef<string | null>(null);
  const studentStatus = !selectedSchedule.present
    ? selectedSchedule.activity === "absent"
      ? "Not in this lesson"
      : selectedSchedule.activity === "waiting"
        ? "Not arrived"
        : activeSession
          ? "Away on break"
          : "Off campus"
    : selectedSchedule.transition === "entering"
      ? classStatus.phase === "break"
        ? "Returning"
        : "Arriving"
      : selectedSchedule.transition === "leaving"
        ? "Leaving"
        : commands[selectedStudent].action === "standing"
          ? "Pitching"
          : commands[selectedStudent].action === "door"
            ? "At door"
            : selectedSchedule.activity === "golden"
              ? classStatus.goldenStage === "solution"
                ? "Reviewing solution"
                : selectedSchedule.showBoard
                  ? `Shown ${selectedSchedule.answer}`
                  : "Thinking"
              : selectedSchedule.activity === "snack"
                ? "Snacking"
                : selectedSchedule.activity === "rest"
                  ? "On break"
                  : lesson.mode === "explain"
                    ? "Following on the board"
                    : selectedSchedule.marking === "current"
                      ? "Being marked"
                      : selectedSchedule.marking === "marked"
                        ? selectedSchedule.markCorrect
                          ? "Marked correct"
                          : "Fixing a mistake"
                        : "Solving";
  const selectedQueuePosition = visitOrder.indexOf(selectedStudent);
  const viewLabel =
    view === "dollhouse" ? "Dollhouse" : view === "teacher" ? "Teacher eye" : "Clock";
  const demoLabel = demoMode
    ? (demoScenarios.find((scenario) => scenario.id === demoScenario)?.label ?? "Demo")
    : "Live schedule";
  const togglePanel = (panel: keyof Omit<PanelState, "focus">) =>
    setPanels((current) => ({ ...current, [panel]: !current[panel] }));

  useEffect(() => {
    try {
      window.localStorage.setItem(panelStorageKey, JSON.stringify(panels));
    } catch {
      // Storage can be unavailable in private or embedded browser contexts.
    }
  }, [panels]);

  useEffect(() => {
    const timer = window.setInterval(() => setSeoulTime(getSeoulTime()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!demoMode) return;
    const timer = window.setInterval(() => setDemoNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [demoMode]);

  const startDemo = (scenario: DemoScenario) => {
    const now = Date.now();
    setDemoMode(true);
    setDemoScenario(scenario);
    setDemoRun((value) => value + 1);
    setDemoStartedAt(now);
    setDemoNow(now);
  };

  const applyStudentCount = (value: number) => {
    const count = THREE.MathUtils.clamp(Math.round(value), 1, maxStudents);
    setDemoStudentCount(count);
    setStudentCountDraft(String(count));
    if (!demoMode) startDemo(demoScenario);
  };

  useEffect(() => {
    if (classStatus.phaseKey && previousPhase.current !== classStatus.phaseKey) {
      setCommands((current) =>
        current.map((command) => ({ action: "seated", commandId: command.commandId + 1 })),
      );
    }
    previousPhase.current = classStatus.phaseKey;
  }, [classStatus.phaseKey]);

  useEffect(() => {
    // Scheduled exits and returns take priority over any previous manual command.
    setCommands((current) =>
      current.map((command, index) =>
        studentSchedules[index].transition === "none"
          ? command
          : { action: "seated", commandId: command.commandId + 1 },
      ),
    );
  }, [transitionSignature]);

  const issueCommand = (action: StudentAction) => {
    if (!selectedStudentAvailable) return;
    setCommands((current) =>
      current.map((command, index) =>
        index === selectedStudent ? { action, commandId: command.commandId + 1 } : command,
      ),
    );
  };

  return (
    <main className="app-shell">
      <div className="scene">
        <Scene
          view={view}
          swapped={swapped}
          allocation={allocation}
          studentDoor={studentDoor}
          doorOpen={doorOpen || studentDoorTransitionOpen}
          teacherDoorOpen={teacherDoorTransitionOpen}
          commands={commands}
          studentSchedules={studentSchedules}
          selectedStudent={selectedStudent}
          onSelectStudent={(id) => {
            setSelectedStudent(id);
            if (view === "clock") setView(viewBeforeClock);
          }}
          onDoorToggle={() => setDoorOpen((value) => !value)}
          clockMode={clockMode}
          clockTime={seoulTime}
          classStatus={classStatus}
          teacherSchedule={teacherSchedule}
          markingStudent={markingStudent}
          teacherSpeed={demoMode ? 1.55 : 1.05}
          onClockFocus={() => {
            if (view !== "clock") setViewBeforeClock(view);
            setView("clock");
          }}
          onSceneClick={() => {
            if (view === "clock") setView(viewBeforeClock);
          }}
        />
      </div>

      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p>
            {demoMode ? "Demo · " : ""}
            {activeSession
              ? `Class ${activeSession.id} · ${
                  classStatus.phase === "arrival"
                    ? "Arrival window"
                    : classStatus.phase === "golden"
                      ? `Golden Bell Q${classStatus.questionIndex + 1}/${classStatus.questionCount} · ${
                          classStatus.goldenStage === "solution"
                            ? "Solution"
                            : classStatus.reveal
                              ? "Answers"
                              : `${formatDuration(classStatus.answerSeconds - classStatus.questionElapsed)} left`
                        }`
                      : classStatus.phase === "lesson"
                        ? `Lesson ${classStatus.cycle + 1} · ${
                            lesson.mode === "explain"
                              ? `Explaining #${textbookProblems[lesson.problemId].number}`
                              : `Marking ${Math.min(Math.max(lesson.visitIndex, 0), lesson.visitCount)}/${lesson.visitCount}`
                          }`
                        : `Recess · back by ${formatSeconds(classStatus.returnBy ?? 0)}`
                }`
              : nowInSeconds < classSchedule[0].startsAt - 10 * 60
                ? "Next: Class A · 16:00 KST"
                : nowInSeconds < classSchedule[1].startsAt - 10 * 60
                  ? "Next: Class B · 18:10 KST"
                  : "Classes complete · Seoul"}
          </p>
          <h1>Classroom model</h1>
        </div>
        <button
          type="button"
          className={panels.focus ? "focus-button active" : "focus-button"}
          aria-pressed={panels.focus}
          onClick={() => setPanels((current) => ({ ...current, focus: !current.focus }))}
        >
          <FocusIcon active={panels.focus} />
          <span>{panels.focus ? "Show controls" : "Focus"}</span>
        </button>
      </header>

      {!panels.focus && panels.student && (
        <button
          type="button"
          className="panel-pill student-pill"
          onClick={() => togglePanel("student")}
        >
          <span className="pill-avatar">{selectedStudent + 1}</span>
          <span>{studentNames[selectedStudent]}</span>
          <small>{studentStatus}</small>
          <PanelIcon expanded={false} />
        </button>
      )}

      {!panels.focus && !panels.student && (
        <section
          className="student-panel"
          aria-label={`Actions for ${studentNames[selectedStudent]}`}
        >
          <div className="student-heading">
            <span className="student-avatar">{selectedStudent + 1}</span>
            <div>
              <p>Selected student</p>
              <h2>{studentNames[selectedStudent]}</h2>
            </div>
            <span className="student-status">{studentStatus}</span>
            <button
              type="button"
              className="panel-minimize"
              aria-label="Minimize selected student panel"
              onClick={() => togglePanel("student")}
            >
              <PanelIcon expanded />
            </button>
          </div>
          <div className="student-actions">
            <button
              type="button"
              className={commands[selectedStudent].action === "seated" ? "active" : ""}
              disabled={!selectedStudentAvailable}
              onClick={() => issueCommand("seated")}
            >
              <span>Sit & solve</span>
              <small>Textbook work</small>
            </button>
            <button
              type="button"
              className={commands[selectedStudent].action === "standing" ? "active" : ""}
              disabled={!selectedStudentAvailable}
              onClick={() => issueCommand("standing")}
            >
              <span>Stand & pitch</span>
              <small>Speak from seat</small>
            </button>
            <button
              type="button"
              className={commands[selectedStudent].action === "door" ? "active" : ""}
              disabled={!studentDoor || !selectedStudentAvailable}
              onClick={() => issueCommand("door")}
            >
              <span>{doorOpen ? "Close rear door" : "Open rear door"}</span>
              <small>
                {!selectedStudentAvailable
                  ? "Unavailable now"
                  : studentDoor
                    ? "Walk to entrance"
                    : "Door is hidden"}
              </small>
            </button>
          </div>
          {selectedSchedule.activity === "golden" ? (
            <div className="student-meta" aria-label="Golden Bell readiness">
              <span>
                <small>Math</small>
                <strong>{Math.round(selectedSchedule.mathLevel * 100)}</strong>
              </span>
              <span>
                <small>Focus</small>
                <strong>{Math.round(selectedSchedule.concentration * 100)}</strong>
              </span>
              <span>
                <small>Shows at</small>
                <strong>{formatDuration(selectedSchedule.answerAt)}</strong>
              </span>
            </div>
          ) : selectedSchedule.activity === "lesson" && lesson.mode !== "idle" ? (
            <div className="student-meta" aria-label="Textbook lesson progress">
              <span>
                <small>Problem</small>
                <strong>
                  p.{textbookProblems[lesson.problemId].page} #
                  {textbookProblems[lesson.problemId].number}
                </strong>
              </span>
              <span>
                <small>Teacher</small>
                <strong>
                  {lesson.mode === "explain"
                    ? "On iPad"
                    : markingStudent === selectedStudent
                      ? "Here"
                      : markingStudent >= 0
                        ? studentNames[markingStudent]
                        : "Desk"}
                </strong>
              </span>
              <span>
                <small>{lesson.mode === "explain" ? "Next round" : "Turn"}</small>
                <strong>
                  {lesson.mode === "explain"
                    ? formatDuration(lesson.segmentRemaining)
                    : selectedSchedule.marking === "marked"
                      ? selectedSchedule.markCorrect
                        ? "Correct"
                        : "Fix it"
                      : selectedSchedule.marking === "current"
                        ? "Now"
                        : `${selectedQueuePosition - lesson.visitIndex} ahead`}
                </strong>
              </span>
            </div>
          ) : (
            <p className="student-tip">
              Select any student directly in the room to assign an action.
            </p>
          )}
        </section>
      )}

      {!panels.focus && panels.demo && (
        <button type="button" className="panel-pill demo-pill" onClick={() => togglePanel("demo")}>
          <span className={demoMode ? "pill-dot active" : "pill-dot"} />
          <span>{demoMode ? "Demo" : "Live"}</span>
          <small>{demoLabel}</small>
          <PanelIcon expanded={false} />
        </button>
      )}

      {!panels.focus && !panels.demo && (
        <section className="demo-dock" aria-label="Demo controls">
          <button
            type="button"
            className="demo-switch"
            role="switch"
            aria-checked={demoMode}
            onClick={() => (demoMode ? setDemoMode(false) : startDemo(demoScenario))}
          >
            <span>
              <strong>Demo mode</strong>
              <small>{demoMode ? "Replay animations" : "Live Seoul schedule"}</small>
            </span>
            <i className={demoMode ? "toggle active" : "toggle"} aria-hidden="true">
              <b />
            </i>
          </button>
          <div className="demo-actions">
            {demoScenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className={demoMode && demoScenario === scenario.id ? "active" : ""}
                onClick={() => startDemo(scenario.id)}
              >
                <span>{scenario.label}</span>
                <small>{scenario.detail}</small>
              </button>
            ))}
          </div>
          <div className="demo-count">
            <label htmlFor="demo-student-count">
              <strong>Students</strong>
              <small>1–{maxStudents}</small>
            </label>
            <div className="demo-count-field">
              <button
                type="button"
                aria-label="Fewer students"
                disabled={demoStudentCount <= 1}
                onClick={() => applyStudentCount(demoStudentCount - 1)}
              >
                −
              </button>
              <input
                id="demo-student-count"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={studentCountDraft}
                onChange={(event) => {
                  const draft = event.target.value.replace(/\D/g, "");
                  setStudentCountDraft(draft);
                  const parsed = Number(draft);
                  if (draft && parsed >= 1 && parsed <= maxStudents) applyStudentCount(parsed);
                }}
                onBlur={() =>
                  applyStudentCount(
                    studentCountDraft ? Number(studentCountDraft) : demoStudentCount,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    applyStudentCount(demoStudentCount + 1);
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    applyStudentCount(demoStudentCount - 1);
                  }
                }}
              />
              <button
                type="button"
                aria-label="More students"
                disabled={demoStudentCount >= maxStudents}
                onClick={() => applyStudentCount(demoStudentCount + 1)}
              >
                +
              </button>
            </div>
          </div>
          <button
            type="button"
            className="panel-minimize demo-minimize"
            aria-label="Minimize demo controls"
            onClick={() => togglePanel("demo")}
          >
            <PanelIcon expanded />
          </button>
        </section>
      )}

      {!panels.focus && panels.view && (
        <button type="button" className="panel-pill view-pill" onClick={() => togglePanel("view")}>
          <span>{viewLabel}</span>
          <small>{allocation === "4x3" ? "4 × 3" : "3 × 4"}</small>
          <PanelIcon expanded={false} />
        </button>
      )}

      {!panels.focus && !panels.view && (
        <section className="view-panel" aria-label="Scene controls">
          <div className="panel-heading">
            <span>Viewpoint</span>
            <span className="panel-heading-actions">
              <span className="live-dot">Interactive</span>
              <button
                type="button"
                className="panel-minimize"
                aria-label="Minimize viewpoint panel"
                onClick={() => togglePanel("view")}
              >
                <PanelIcon expanded />
              </button>
            </span>
          </div>
          <div className="view-switcher">
            {(["dollhouse", "teacher"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={view === mode ? "active" : ""}
                aria-pressed={view === mode}
              >
                <ViewIcon mode={mode} />
                <span>{mode === "dollhouse" ? "Dollhouse" : "Teacher eye"}</span>
              </button>
            ))}
          </div>
          <div className="room-switches">
            <button
              type="button"
              className="switch-row"
              role="switch"
              aria-checked={swapped}
              onClick={() => setSwapped((value) => !value)}
            >
              <span>
                <strong>Move teaching station</strong>
                <small>{swapped ? "Teacher & desk left" : "Teacher & desk right"}</small>
              </span>
              <i className={swapped ? "toggle active" : "toggle"} aria-hidden="true">
                <b />
              </i>
            </button>
            <button
              type="button"
              className="switch-row"
              role="switch"
              aria-checked={allocation === "3x4"}
              onClick={() => setAllocation((value) => (value === "4x3" ? "3x4" : "4x3"))}
            >
              <span>
                <strong>3 × 4 desk layout</strong>
                <small>{allocation === "3x4" ? "3 columns · 4 rows" : "4 columns · 3 rows"}</small>
              </span>
              <i className={allocation === "3x4" ? "toggle active" : "toggle"} aria-hidden="true">
                <b />
              </i>
            </button>
            <button
              type="button"
              className="switch-row"
              role="switch"
              aria-checked={clockMode === "digital"}
              onClick={() => setClockMode((value) => (value === "analog" ? "digital" : "analog"))}
            >
              <span>
                <strong>Digital classroom clock</strong>
                <small>
                  {clockMode === "digital" ? "Digital · Seoul KST" : "Analog · Seoul KST"}
                </small>
              </span>
              <i
                className={clockMode === "digital" ? "toggle active" : "toggle"}
                aria-hidden="true"
              >
                <b />
              </i>
            </button>
            <button
              type="button"
              className="switch-row"
              role="switch"
              aria-checked={studentDoor}
              onClick={() => {
                setStudentDoor((value) => !value);
                if (studentDoor) setDoorOpen(false);
              }}
            >
              <span>
                <strong>Rear student door</strong>
                <small>
                  {studentDoor ? "Student entrance visible" : "Student entrance removed"}
                </small>
              </span>
              <i className={studentDoor ? "toggle active" : "toggle"} aria-hidden="true">
                <b />
              </i>
            </button>
          </div>
        </section>
      )}

      {!panels.focus && (
        <aside className="room-note">
          <span className="eyebrow">Layout</span>
          <strong>{allocation === "4x3" ? "4 × 3" : "3 × 4"}</strong>
          <p>
            {studentSchedules.filter((schedule) => schedule.present).length} of{" "}
            {demoMode ? demoStudentCount : maxStudents} students present
          </p>
          <p>Teacher · {teacherActivity}</p>
          <p>
            {demoMode
              ? "Demo replay · real schedule paused"
              : "Class A 16:00–17:50 · Class B 18:10–21:00"}
          </p>
          <p>Golden Bell first 50 min · 10 min recesses</p>
        </aside>
      )}

      {!panels.focus && (
        <div className="hint">
          <span className="mouse-icon" aria-hidden="true" />
          Drag to orbit · Scroll to zoom
        </div>
      )}

      <div className="warm-glow" aria-hidden="true" />
    </main>
  );
}
