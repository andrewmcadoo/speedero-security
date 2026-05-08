import { Resend } from "resend";

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email not configured");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !from) {
    throw new EmailNotConfiguredError();
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message}`);
  }
}
