// Works out what a file REALLY is by looking at its first bytes,
// so a program renamed to "report.pdf" is still refused.

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface DetectedType {
  mime: string;
  ext: string;
}

export function detectFileType(buffer: Buffer): DetectedType | null {
  if (buffer.length < 12) {
    return null;
  }

  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

// A readable, safe file name to show and to download as
export function cleanFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\\/]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f"<>:*?|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  return cleaned || fallback;
}
