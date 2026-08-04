import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import nodemailer, { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import { EnvironmentVariables } from 'src/config';

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export interface MailMessage extends MailContent {
  to: string;
}

@Injectable()
export class MailService {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options>;
  private readonly from: { address: string; name: string };

  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {
    const username = this.configService.get('SMTP_USERNAME', { infer: true });
    const password = this.configService.get('SMTP_PASSWORD', { infer: true });

    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow('SMTP_HOST', { infer: true }),
      port: this.configService.getOrThrow('SMTP_PORT', { infer: true }),
      secure: this.configService.getOrThrow('SMTP_SECURE', { infer: true }),
      ...(username && password ? { auth: { user: username, pass: password } } : {}),
    });
    this.from = {
      address: this.configService.getOrThrow('SMTP_FROM_ADDRESS', { infer: true }),
      name: this.configService.getOrThrow('SMTP_FROM_NAME', { infer: true }),
    };
  }

  async send({ to, subject, text, html }: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
      html,
    });
  }
}
