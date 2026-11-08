// Pure grading rules. No database and no Nest in this file, so it is easy to test.

export interface GradeBandInput {
  grade: string;
  minScore: number;
  remark?: string | null;
  points?: number | null;
}

// The scale the app has always used (70+ = A, 60+ = B, ...).
// A school that has not set up its own scale keeps getting exactly this.
export const LEGACY_BANDS: GradeBandInput[] = [
  { grade: 'A', minScore: 70, remark: 'Excellent' },
  { grade: 'B', minScore: 60, remark: 'Very Good' },
  { grade: 'C', minScore: 50, remark: 'Good' },
  { grade: 'D', minScore: 45, remark: 'Fair' },
  { grade: 'E', minScore: 40, remark: 'Pass' },
  { grade: 'F', minScore: 0, remark: 'Fail' },
];

export function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// score out of max -> percentage (0 if max is not a positive number)
export function percentageOf(score: number, max: number): number {
  if (!(max > 0)) {
    return 0;
  }

  return roundTo2((score / max) * 100);
}

// Pick the band with the highest minScore that the percentage reaches.
// Only the minimum is stored, so a score like 69.5 can never fall into a gap.
export function gradeFor(
  bands: GradeBandInput[],
  percentage: number,
): GradeBandInput {
  if (bands.length === 0) {
    throw new Error('A grading scale needs at least one band');
  }

  if (Number.isNaN(percentage)) {
    throw new Error('Percentage must be a number');
  }

  const pct = roundTo2(percentage);
  const highestFirst = [...bands].sort((a, b) => b.minScore - a.minScore);

  return (
    highestFirst.find((band) => pct >= band.minScore) ??
    highestFirst[highestFirst.length - 1]
  );
}

// Returns a list of problems. An empty list means the scale is valid.
export function validateBands(bands: GradeBandInput[]): string[] {
  const errors: string[] = [];

  if (bands.length === 0) {
    return ['A grading scale needs at least one band'];
  }

  const seenGrades = new Set<string>();
  const seenMins = new Set<number>();

  bands.forEach((band, index) => {
    const label = `Band ${index + 1}`;
    const grade = (band.grade ?? '').trim();

    if (grade.length === 0) {
      errors.push(`${label}: grade is required`);
    } else if (grade.length > 10) {
      errors.push(`${label}: grade must be 10 characters or fewer`);
    } else {
      const key = grade.toLowerCase();

      if (seenGrades.has(key)) {
        errors.push(`Grade "${grade}" is used more than once`);
      }

      seenGrades.add(key);
    }

    if (
      !Number.isFinite(band.minScore) ||
      band.minScore < 0 ||
      band.minScore > 100
    ) {
      errors.push(`${label}: minScore must be a number from 0 to 100`);
    } else {
      if (seenMins.has(band.minScore)) {
        errors.push(`Two bands start at ${band.minScore}`);
      }

      seenMins.add(band.minScore);
    }

    if (
      band.points != null &&
      (!Number.isFinite(band.points) || band.points < 0)
    ) {
      errors.push(`${label}: points must be 0 or more`);
    }
  });

  if (!bands.some((band) => band.minScore === 0)) {
    errors.push('One band must start at 0 so every score gets a grade');
  }

  return errors;
} 