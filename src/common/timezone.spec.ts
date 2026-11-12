import { describe, expect, it } from '@jest/globals';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  localDateKey,
  startOfLocalDate,
} from './timezone';

describe('timezone helpers', () => {
  it('uses the requested timezone when deriving a local date', () => {
    expect(localDateKey(new Date('2026-11-12T23:30:00.000Z'), 'Africa/Lagos'))
      .toBe('2026-11-13');
  });

  it('calculates local midnight across a daylight-saving transition', () => {
    expect(startOfLocalDate('2026-03-08', 'America/New_York'))
      .toEqual(new Date('2026-03-08T05:00:00.000Z'));
    expect(startOfLocalDate('2026-03-09', 'America/New_York'))
      .toEqual(new Date('2026-03-09T04:00:00.000Z'));
  });

  it('shifts and compares calendar dates without assuming 24-hour local days', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetweenDateKeys('2026-03-07', '2026-03-09')).toBe(2);
  });
});
