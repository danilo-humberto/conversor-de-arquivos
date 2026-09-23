import { verifySmtpConnection } from "../notifications/smtp.js";

try {
  await verifySmtpConnection();

  console.log("SMTP connection is available.");
} catch (error) {
  console.error("SMTP connection is not available.", error);

  process.exitCode = 1;
}
