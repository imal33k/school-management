import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  assertConfigured() {
    const port = Number(process.env.SMTP_PORT);
    if (
      !process.env.SMTP_HOST ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD ||
      !process.env.MAIL_FROM
    ) {
      throw new ServiceUnavailableException(
        'SMTP email delivery is not configured',
      );
    }
  }

  async send(to: string, subject: string, text: string) {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    const from = process.env.MAIL_FROM;

    this.assertConfigured();

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: { user, pass },
    });

    try {
      await transporter.sendMail({ from, to, subject, text });
    } catch (error) {
      throw new ServiceUnavailableException('Email delivery failed', {
        cause: error,
      });
    }
  }
}
