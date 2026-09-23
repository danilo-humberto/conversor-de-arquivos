import nodemailer from "nodemailer";

import { env } from "../config/env.js";

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: false,
});

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function verifySmtpConnection(): Promise<void> {
  await transporter.verify();
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  await transporter.sendMail({
    from: env.smtp.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}
