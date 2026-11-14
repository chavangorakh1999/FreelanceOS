import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable per delivery, so a provider (or a human) can recognise a repeated send. */
  messageId: string;
}

/** The only thing the rest of the system knows about email. Swap the implementation, not the callers (PRD §12.2). */
export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Development provider: logs instead of sending, and remembers recent messages so tests and screens can show them. */
export class LogEmailProvider implements EmailProvider {
  private readonly log = new Logger('Email');
  readonly sent: EmailMessage[] = [];

  async send(m: EmailMessage) {
    this.sent.push(m);
    if (this.sent.length > 200) this.sent.shift();
    const link = /https?:\/\/\S+/.exec(m.text)?.[0];
    this.log.log(`[not sent — log provider] to=${m.to} subject="${m.subject}"${link ? ` link=${link}` : ''}`);
    return { providerMessageId: `log-${m.messageId}` };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: nodemailer.Transporter;
  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(m: EmailMessage) {
    const info = await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html, messageId: `<${m.messageId}@freelanceos>` });
    return { providerMessageId: String(info.messageId) };
  }
}
