// Draws report cards as a PDF (one page per student). Pure: it only takes
// plain data and returns the PDF bytes, so it is easy to test.
//
// Note: the built-in PDF fonts (Helvetica) cover English and most Western
// European letters. If you need other alphabets or symbols such as the
// Naira sign, register a .ttf font with doc.registerFont(...) instead.

import PDFDocument from 'pdfkit';

import { ordinal } from './ranking.logic';
import type { ReportCardView } from './report-card.types';

const LEFT = 40;
const WIDTH = 515;
const BOTTOM = 800; // keep content above this line

const DARK = '#1a1a1a';
const MUTED = '#666666';
const RULE = '#cccccc';
const HEAD_FILL = '#e9edf3';
const ZEBRA = '#f7f8fa';
const ACCENT = '#1f3a5f';
const RED = '#b00020';

type Doc = InstanceType<typeof PDFDocument>;

export function renderReportCardsPdf(views: ReportCardView[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (views.length === 0) {
      reject(new Error('There are no report cards to print'));
      return;
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      autoFirstPage: false,
      info: { Title: 'Report Card', Producer: 'School Management' },
    });

    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      for (const view of views) {
        drawCard(doc, view);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function text(
  doc: Doc,
  value: string,
  x: number,
  y: number,
  options: {
    width: number;
    size?: number;
    bold?: boolean;
    color?: string;
    align?: 'left' | 'center' | 'right';
  },
) {
  doc
    .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(options.size ?? 9)
    .fillColor(options.color ?? DARK)
    .text(value, x, y, {
      width: options.width,
      // height + ellipsis = one line only; too-long text ends in "..."
      height: (options.size ?? 9) * 1.3,
      align: options.align ?? 'left',
      ellipsis: true,
    });
}

function rule(doc: Doc, y: number, color = RULE) {
  doc.moveTo(LEFT, y).lineTo(LEFT + WIDTH, y).lineWidth(0.7).strokeColor(color).stroke();
}

function drawCard(doc: Doc, v: ReportCardView) {
  doc.addPage();

  let y = 40;

  const ensureSpace = (height: number) => {
    if (y + height > BOTTOM) {
      doc.addPage();
      y = 40;
    }
  };

  // ---------- Header ----------
  if (v.status === 'DRAFT') {
    text(doc, 'DRAFT - NOT YET PUBLISHED', LEFT, y - 14, { width: WIDTH, size: 8, bold: true, color: RED, align: 'right' });
  }

  text(doc, v.school.name, LEFT, y + 6, { width: WIDTH, size: 18, bold: true, color: ACCENT, align: 'center' });
  y += 32;

  const contact = [v.school.address, v.school.phone, v.school.email].filter(Boolean).join('   |   ');

  if (contact) {
    text(doc, contact, LEFT, y, { width: WIDTH, size: 8.5, color: MUTED, align: 'center' });
    y += 15;
  }

  y += 2;
  rule(doc, y, ACCENT);
  y += 12;

  text(doc, 'STUDENT REPORT CARD', LEFT, y, { width: WIDTH, size: 13, bold: true, align: 'center' });
  y += 20;
  text(doc, `${v.examination.name}   -   ${v.term.name}   -   ${v.session.name}`, LEFT, y, {
    width: WIDTH, size: 9.5, color: MUTED, align: 'center',
  });
  y += 24;

  // ---------- Student block ----------
  const boxTop = y;
  doc.roundedRect(LEFT, boxTop, WIDTH, 50, 4).lineWidth(0.7).strokeColor(RULE).stroke();

  const field = (label: string, value: string, x: number, fy: number, w: number) => {
    text(doc, label, x, fy, { width: 80, size: 8, color: MUTED });
    text(doc, value, x + 80, fy, { width: w - 80, size: 10, bold: true });
  };

  const fullName = `${v.student.firstName} ${v.student.lastName}`;
  const positionText = v.summary.position ? `${ordinal(v.summary.position)} of ${v.summary.classSize}` : '-';

  field('Student', fullName, LEFT + 12, boxTop + 10, 250);
  field('Admission No.', v.student.admissionNumber ?? '-', LEFT + 12, boxTop + 29, 250);
  field('Class', v.class.name, LEFT + 275, boxTop + 10, 230);
  field('Position', positionText, LEFT + 275, boxTop + 29, 230);
  y = boxTop + 50 + 16;

  // ---------- Results table ----------
  const n = v.components.length;
  const subjectW = 125;
  const totalW = 40;
  const gradeW = 38;
  const posW = 40;
  const minRemarkW = 80;
  const available = WIDTH - subjectW - totalW - gradeW - posW - minRemarkW;
  const compW = n === 0 ? 0 : Math.max(28, Math.min(55, Math.floor(available / n)));
  const remarkW = WIDTH - subjectW - compW * n - totalW - gradeW - posW;

  const columns: { label: string; sub?: string; width: number; align: 'left' | 'center' }[] = [
    { label: 'Subject', width: subjectW, align: 'left' },
    ...v.components.map((c) => ({
      label: c.name,
      sub: `/${c.maxScore}`,
      width: compW,
      align: 'center' as const,
    })),
    { label: 'Total', width: totalW, align: 'center' },
    { label: 'Grade', width: gradeW, align: 'center' },
    { label: 'Pos.', width: posW, align: 'center' },
    { label: 'Remark', width: remarkW, align: 'left' },
  ];

  const rowH = 18;
  const headH = 28;

  const drawHeader = () => {
    doc.rect(LEFT, y, WIDTH, headH).fillColor(HEAD_FILL).fill();
    let x = LEFT;

    for (const col of columns) {
      const size = n > 4 && col.sub ? 6.5 : 7.5;

      text(doc, col.label, x + 2, y + (col.sub ? 6 : 10), {
        width: col.width - 4, size, bold: true, color: ACCENT, align: col.align,
      });

      if (col.sub) {
        text(doc, col.sub, x + 2, y + 16, { width: col.width - 4, size: 6.5, color: MUTED, align: 'center' });
      }

      x += col.width;
    }

    y += headH;
  };

  drawHeader();

  const remarkFor = (grade: string | null, saved: string | null) =>
    saved ?? v.gradeKey.find((band) => band.grade === grade)?.remark ?? '';

  v.subjects.forEach((subject, index) => {
    if (y + rowH > BOTTOM - 150) {
      doc.addPage();
      y = 40;
      drawHeader();
    }

    if (index % 2 === 1) {
      doc.rect(LEFT, y, WIDTH, rowH).fillColor(ZEBRA).fill();
    }

    const cells = [
      subject.subject,
      ...v.components.map((c) => (subject.scores[c.id] !== undefined ? String(subject.scores[c.id]) : '-')),
      String(subject.totalScore),
      subject.grade ?? '-',
      subject.position ? ordinal(subject.position) : '-',
      remarkFor(subject.grade, subject.remark),
    ];

    let x = LEFT;

    cells.forEach((cell, i) => {
      text(doc, cell, x + 3, y + 5, {
        width: columns[i].width - 6,
        size: 9,
        bold: i === 0 || i === cells.length - 4 || i === cells.length - 3,
        align: columns[i].align,
      });
      x += columns[i].width;
    });

    y += rowH;
  });

  rule(doc, y);
  y += 16;

  // ---------- Summary boxes ----------
  ensureSpace(60);

  const gap = 8;
  const boxW = (WIDTH - gap * 3) / 4;
  const stats = [
    { label: 'Total score', value: String(v.summary.totalScore) },
    { label: 'Average', value: `${v.summary.average}%` },
    { label: 'Position', value: positionText },
    { label: 'Overall grade', value: v.summary.overallGrade ?? '-' },
  ];

  stats.forEach((stat, i) => {
    const x = LEFT + i * (boxW + gap);
    doc.roundedRect(x, y, boxW, 40, 4).fillColor(ZEBRA).fill();
    doc.roundedRect(x, y, boxW, 40, 4).lineWidth(0.7).strokeColor(RULE).stroke();
    text(doc, stat.label, x + 8, y + 7, { width: boxW - 16, size: 7.5, color: MUTED });
    text(doc, stat.value, x + 8, y + 19, { width: boxW - 16, size: 13, bold: true, color: ACCENT });
  });

  y += 40 + 14;

  // ---------- Attendance ----------
  text(
    doc,
    `Attendance:   school opened ${v.attendance.daysOpened} day(s)   |   present ${v.attendance.present}   |   absent ${v.attendance.absent}   |   excused ${v.attendance.excused}`,
    LEFT, y, { width: WIDTH, size: 9, color: MUTED },
  );
  y += 24;

  // ---------- Remarks ----------
  const remarkBlock = (label: string, value: string | null) => {
    const body = value ?? '';
    doc.font('Helvetica').fontSize(9);
    const bodyH = Math.max(28, doc.heightOfString(body, { width: WIDTH - 16 }) + 10);

    ensureSpace(bodyH + 18);
    text(doc, label, LEFT, y, { width: WIDTH, size: 8.5, bold: true, color: ACCENT });
    y += 13;
    doc.roundedRect(LEFT, y, WIDTH, bodyH, 3).lineWidth(0.7).strokeColor(RULE).stroke();

    if (body) {
      doc.font('Helvetica').fontSize(9).fillColor(DARK).text(body, LEFT + 8, y + 6, { width: WIDTH - 16 });
    }

    y += bodyH + 12;
  };

  const overallBand = v.gradeKey.find((band) => band.grade === v.summary.overallGrade);

  remarkBlock("Class teacher's remark", v.teacherRemark ?? overallBand?.remark ?? null);
  remarkBlock("Principal's remark", v.principalRemark);

  // ---------- Signatures ----------
  ensureSpace(50);
  y += 18;

  const sigW = 150;
  ['Class teacher', 'Principal', 'Date'].forEach((label, i) => {
    const x = LEFT + i * ((WIDTH - sigW) / 2);
    doc.moveTo(x, y).lineTo(x + sigW, y).lineWidth(0.7).strokeColor(MUTED).stroke();
    text(doc, label, x, y + 4, { width: sigW, size: 8, color: MUTED, align: 'center' });
  });

  y += 30;

  // ---------- Grading key ----------
  ensureSpace(40);
  text(doc, 'Grading key', LEFT, y, { width: WIDTH, size: 8, bold: true, color: MUTED });
  y += 11;

  const keyText = v.gradeKey
    .map((band) => `${band.grade}: ${band.minScore}% and above${band.remark ? ` (${band.remark})` : ''}`)
    .join('     ');

  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(keyText, LEFT, y, { width: WIDTH });
}
