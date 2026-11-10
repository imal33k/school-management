// Draws one payment receipt as a PDF. Pure: plain data in, PDF bytes out.
// The built-in PDF font has no Naira sign, so amounts show the currency code.

import PDFDocument from 'pdfkit';

export interface ReceiptData {
  receiptNumber: string;
  issuedAt: Date;
  school: { name: string; address: string | null; phone: string | null; email: string | null };
  student: { name: string; admissionNumber: string | null };
  description: string; // e.g. "Tuition - First Term"
  invoiceNumber: string | null;
  method: string;
  reference: string;
  amountPaid: string; // already formatted, e.g. "NGN 25,000.00"
  invoiceTotal: string | null;
  totalPaidSoFar: string | null;
  balance: string | null;
}

const ACCENT = '#1f3a5f';
const MUTED = '#666666';
const DARK = '#1a1a1a';
const RULE = '#cccccc';

export function renderReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: `Receipt ${data.receiptNumber}` } });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const left = 36;
      const width = doc.page.width - 72;
      let y = 36;

      const line = (value: string, x: number, at: number, w: number, size = 9, bold = false, color = DARK, align: 'left' | 'right' | 'center' = 'left') => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
          .text(value, x, at, { width: w, height: size * 1.3, ellipsis: true, align });
      };

      line(data.school.name, left, y, width, 16, true, ACCENT, 'center');
      y += 24;

      const contact = [data.school.address, data.school.phone, data.school.email].filter(Boolean).join('  |  ');

      if (contact) {
        line(contact, left, y, width, 8, false, MUTED, 'center');
        y += 14;
      }

      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.8).strokeColor(ACCENT).stroke();
      y += 12;

      line('PAYMENT RECEIPT', left, y, width, 12, true, DARK, 'center');
      y += 22;

      const row = (label: string, value: string) => {
        line(label, left, y, 105, 8.5, false, MUTED);
        line(value, left + 110, y, width - 110, 9.5, true);
        y += 17;
      };

      row('Receipt No.', data.receiptNumber);
      row('Date', data.issuedAt.toISOString().slice(0, 10));
      row('Received from', data.student.name);

      if (data.student.admissionNumber) {
        row('Admission No.', data.student.admissionNumber);
      }

      row('Payment for', data.description);

      if (data.invoiceNumber) {
        row('Invoice No.', data.invoiceNumber);
      }

      row('Method', data.method);
      row('Reference', data.reference);

      y += 6;
      doc.roundedRect(left, y, width, 46, 4).fillColor('#f2f5f9').fill();
      doc.roundedRect(left, y, width, 46, 4).lineWidth(0.7).strokeColor(RULE).stroke();
      line('AMOUNT PAID', left + 12, y + 8, width - 24, 8, false, MUTED);
      line(data.amountPaid, left + 12, y + 20, width - 24, 17, true, ACCENT);
      y += 60;

      if (data.invoiceTotal) {
        row('Invoice total', data.invoiceTotal);
        row('Paid so far', data.totalPaidSoFar ?? '-');
        row('Balance', data.balance ?? '-');
      }

      y += 8;
      line('This receipt was generated electronically and is valid without a signature.', left, y, width, 7.5, false, MUTED, 'center');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
