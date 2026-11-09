// Pure ranking rules for class positions. No database and no Nest here.

import { percentageOf, roundTo2 } from '../grading/grading.logic';

export interface Rankable {
  id: string;
  value: number;
}

// Standard competition ranking: the best value is 1st, and tied values
// share a position (1, 2, 2, 4). Values are rounded to 2 decimals first,
// so tiny floating-point noise can never split a tie.
export function rankDescending(items: Rankable[]): Map<string, number> {
  const rounded = items.map((item) => ({
    id: item.id,
    value: roundTo2(item.value),
  }));

  const ranks = new Map<string, number>();

  for (const item of rounded) {
    const better = rounded.filter((other) => other.value > item.value).length;
    ranks.set(item.id, better + 1);
  }

  return ranks;
}

// 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 21 -> "21st"
export function ordinal(n: number): string {
  const lastTwo = n % 100;

  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${n}th`;
  }

  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export interface SubjectMark {
  totalScore: number;
  maxScore: number;
}

export interface StudentSummary {
  totalScore: number;
  maxTotal: number;
  average: number; // percentage
  subjectCount: number;
}

// A student's overall figures from the subjects they have a result for.
// The average is a percentage of what was possible for THOSE subjects,
// so a student who missed a subject is not unfairly pushed down or up.
export function summarizeStudent(marks: SubjectMark[]): StudentSummary {
  const totalScore = roundTo2(marks.reduce((sum, m) => sum + m.totalScore, 0));
  const maxTotal = roundTo2(marks.reduce((sum, m) => sum + m.maxScore, 0));

  return {
    totalScore,
    maxTotal,
    average: percentageOf(totalScore, maxTotal),
    subjectCount: marks.length,
  };
}
