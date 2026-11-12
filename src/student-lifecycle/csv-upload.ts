import { BadRequestException } from "@nestjs/common";
import type { UploadedFileLike } from "../common/uploaded-file";

export function csvTextFrom(file: UploadedFileLike | undefined ): string {
if (!file || file.size === 0 ){
    throw new BadRequestException(' Attach a CSV file in the file field');
}
 if (!/\.csv$/i.test(file.originalname)) {
    throw new BadRequestException('The file must be a .csv file');
  }

  // .xlsx files are zip files, which start with "PK"
  if (file.buffer.subarray(0, 2).toString('latin1') === 'PK') {
    throw new BadRequestException(
      'This looks like an Excel file. In Excel choose File > Save As > CSV (Comma delimited) and upload that file.',
    );
  }

  if (file.buffer.includes(0)) {
    throw new BadRequestException('This does not look like a text CSV file');
  }

  return file.buffer.toString('utf8');
}
