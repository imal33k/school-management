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
        'Email verification is unavailable because SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM in the backend environment, then restart the API.',
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
