// Pure rules for turning component scores (CA1, CA2, Exam...) into a result.
// No database and no Nest in this file, so it is easy to test.

import { roundTo2 } from '../grading/grading.logic';

export interface ComponentInfo {
  id: string;
  name: string;
  maxScore: number;
  isExam: boolean;
}

export interface IncomingScore {
  componentId: string;
  score: number;
}

// componentId -> the score saved for it
export type ScoreMap = Record<string, number>;

// What a student's score adds up to if every component is full marks
export function componentTotal(components: ComponentInfo[]): number {
  return roundTo2(components.reduce((sum, c) => sum + c.maxScore, 0));
}

// Returns a list of problems. An empty list means the scores are fine.
export function validateEntryScores(
  components: ComponentInfo[],
  incoming: IncomingScore[],
): string[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const item of incoming) {
    const component = byId.get(item.componentId);

    if (!component) {
      errors.push(`Unknown or inactive component: ${item.componentId}`);
      continue;
    }

    if (seen.has(item.componentId)) {
      errors.push(`${component.name} appears more than once`);
    }

    seen.add(item.componentId);

    if (!Number.isFinite(item.score) || item.score < 0) {
      errors.push(`${component.name}: score must be 0 or more`);
    } else if (item.score > component.maxScore) {
      errors.push(
        `${component.name}: ${item.score} is above the maximum of ${component.maxScore}`,
      );
    }
  }

  return errors;
}

// New scores win over old ones; components not mentioned keep their old score.
export function mergeScores(
  existing: ScoreMap,
  incoming: IncomingScore[],
): ScoreMap {
  const merged: ScoreMap = { ...existing };

  for (const item of incoming) {
    merged[item.componentId] = roundTo2(item.score);
  }

  return merged;
}

export interface ScoreSummary {
  caScore: number | null; // all non-exam components added up (null if none entered)
  examScore: number | null; // the exam component (null if not entered)
  totalScore: number;
  complete: boolean; // every component has a score
  missing: string[]; // names of the components still empty
}

// Only the components you pass in count, so pass the ACTIVE ones.
export function summarizeScores(
  components: ComponentInfo[],
  scores: ScoreMap,
): ScoreSummary {
  let ca = 0;
  let exam = 0;
  let caEntered = false;
  let examEntered = false;
  const missing: string[] = [];

  for (const component of components) {
    const value = scores[component.id];

    if (value === undefined) {
      missing.push(component.name);
      continue;
    }

    if (component.isExam) {
      exam += value;
      examEntered = true;
    } else {
      ca += value;
      caEntered = true;
    }
  }

  return {
    caScore: caEntered ? roundTo2(ca) : null,
    examScore: examEntered ? roundTo2(exam) : null,
    totalScore: roundTo2(ca + exam),
    complete: missing.length === 0,
    missing,
  };
}