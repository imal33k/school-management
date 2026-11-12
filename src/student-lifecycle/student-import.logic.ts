// Pure rules for reading a CSV of students. No database and no Nest here.

import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';

export const MAX_IMPORT_ROWS = 1000;

export interface ImportRowError {
  row: number; // the line number in the file (the header is line 1)
  field?: string;
  message: string;
}

export interface ParsedStudentRow {
  row: number;
  admissionNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth?: Date;
  email?: string;
  phone?: string;
  address?: string;
  className?: string;
}

const HEADER_ALIASES: Record<string, string> = {
  admissionnumber: 'admissionNumber',
  admissionno: 'admissionNumber',
  admno: 'admissionNumber',
  admission: 'admissionNumber',
  firstname: 'firstName',
  givenname: 'firstName',
  lastname: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  middlename: 'middleName',
  othernames: 'middleName',
  gender: 'gender',
  sex: 'gender',
  dateofbirth: 'dateOfBirth',
  dob: 'dateOfBirth',
  birthdate: 'dateOfBirth',
  email: 'email',
  emailaddress: 'email',
  phone: 'phone',
  phonenumber: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  address: 'address',
  class: 'className',
  classname: 'className',
};

export const TEMPLATE_HEADERS = [
  'admissionNumber', 'firstName', 'middleName', 'lastName', 'gender',
  'dateOfBirth', 'email', 'phone', 'address', 'className',
];

export function csvTemplate(): string {
  return [
    TEMPLATE_HEADERS.join(','),
    'GF/2026/0001,Adaeze,Chioma,Okonkwo,FEMALE,2014-03-21,,08012345678,"12 Unity Road, Abuja",JSS 1 A',
    '',
  ].join('\n');
}

function canonicalHeader(header: string): string | null {
  return HEADER_ALIASES[header.trim().toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

// Turns the file text into plain rows keyed by our field names.
export function readCsv(text: string): { rows: Record<string, string>[]; missingColumns: string[] } {
  let records: Record<string, string>[];
  let seen: string[] = [];

  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      columns: (header: string[]) => {
        seen = header.map((h, i) => canonicalHeader(h) ?? `__ignored${i}`);
        return seen;
      },
    }) as Record<string, string>[];
  } catch (error) {
    throw new BadRequestException(
      `The file could not be read as CSV: ${error instanceof Error ? error.message : 'unknown problem'}`,
    );
  }

  const missingColumns = ['admissionNumber', 'firstName', 'lastName'].filter((c) => !seen.includes(c));

  if (records.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(`A file can have at most ${MAX_IMPORT_ROWS} students. This one has ${records.length}.`);
  }

  return { rows: records, missingColumns };
}

export function normalizeGender(value: string): 'MALE' | 'FEMALE' | 'OTHER' | null {
  const v = value.trim().toLowerCase();

  if (['m', 'male', 'boy'].includes(v)) return 'MALE';
  if (['f', 'female', 'girl'].includes(v)) return 'FEMALE';
  if (['o', 'other'].includes(v)) return 'OTHER';

  return null;
}

// Accepts 2014-03-21, 21/03/2014, 21-03-2014 and 21.03.2014
export function parseDate(value: string, now: Date = new Date()): Date | null {
  const text = value.trim();
  let year: number, month: number, day: number;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);

  if (m) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  if (!real || year < 1950 || date > now) {
    return null;
  }

  return date;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRow(raw: Record<string, string>, row: number): { value?: ParsedStudentRow; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const get = (key: string) => (raw[key] ?? '').trim();
  const fail = (field: string, message: string) => errors.push({ row, field, message });

  const admissionNumber = get('admissionNumber');
  const firstName = get('firstName');
  const lastName = get('lastName');

  if (admissionNumber.length < 2) fail('admissionNumber', 'Admission number is required (at least 2 characters)');
  else if (admissionNumber.length > 40) fail('admissionNumber', 'Admission number is too long');

  if (firstName.length < 2) fail('firstName', 'First name is required (at least 2 characters)');
  else if (firstName.length > 60) fail('firstName', 'First name is too long');

  if (lastName.length < 2) fail('lastName', 'Last name is required (at least 2 characters)');
  else if (lastName.length > 60) fail('lastName', 'Last name is too long');

  let gender: ParsedStudentRow['gender'];

  if (get('gender')) {
    gender = normalizeGender(get('gender')) ?? undefined;
    if (!gender) fail('gender', 'Gender must be MALE, FEMALE or OTHER (M and F work too)');
  }

  let dateOfBirth: Date | undefined;

  if (get('dateOfBirth')) {
    dateOfBirth = parseDate(get('dateOfBirth')) ?? undefined;
    if (!dateOfBirth) fail('dateOfBirth', 'Date of birth must be a real past date like 2014-03-21 or 21/03/2014');
  }

  const email = get('email').toLowerCase();

  if (email && !EMAIL.test(email)) fail('email', 'Email is not valid');

  const phone = get('phone').replace(/[\s-]/g, '');

  if (phone && !/^\+?\d{7,15}$/.test(phone)) fail('phone', 'Phone must be 7 to 15 digits (a leading + is allowed)');

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    value: {
      row,
      admissionNumber,
      firstName,
      middleName: get('middleName') || undefined,
      lastName,
      gender,
      dateOfBirth,
      email: email || undefined,
      phone: phone || undefined,
      address: get('address') || undefined,
      className: get('className') || undefined,
    },
  };
}

// The same admission number or email twice in the file: the later row is the mistake
export function findFileDuplicates(rows: ParsedStudentRow[]): ImportRowError[] {
  const errors: ImportRowError[] = [];
  const admissions = new Map<string, number>();
  const emails = new Map<string, number>();

  for (const r of rows) {
    const a = r.admissionNumber.toLowerCase();

    if (admissions.has(a)) {
      errors.push({ row: r.row, field: 'admissionNumber', message: `Admission number ${r.admissionNumber} is already used on row ${admissions.get(a)}` });
    } else {
      admissions.set(a, r.row);
    }

    if (r.email) {
      if (emails.has(r.email)) {
        errors.push({ row: r.row, field: 'email', message: `Email ${r.email} is already used on row ${emails.get(r.email)}` });
      } else {
        emails.set(r.email, r.row);
      }
    }
  }

  return errors;
}
