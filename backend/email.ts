import nodemailer from "nodemailer";
import { resolve4 } from "node:dns/promises";

export async function sendVerificationEmail(
    email: string,
    code: string
) {
    const smtpHost = process.env['SMTP_HOST'];
    const smtpPort = Number(process.env['SMTP_PORT']);
    const smtpUser = process.env['SMTP_USER'];
    const smtpPassword = process.env['SMTP_PASSWORD'];
    const emailFrom = process.env['EMAIL_FROM'];

    if (
        !smtpHost ||
        !smtpUser ||
        !smtpPassword ||
        !emailFrom
    ) {
        throw new Error("Email settings are missing from .env");
    }

    if (smtpPort !== 465) {
        throw new Error("This email configuration expects SMTP_PORT=465");
    }

    // Basic format check. This does not verify mailbox ownership.
    const emailPattern = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;

    if (!emailPattern.test(email) || email.length > 254) {
        throw new Error("Enter one valid email address");
    }

    const codePattern = /^\d{6}$/;

    if (!codePattern.test(code)) {
        throw new Error("The verification code must contain six digits");
    }
    const addresses = await resolve4(smtpHost);
const smtpAddress = addresses[0];

console.log("SMTP address being used:", smtpAddress);

const transporter = nodemailer.createTransport({
    host: smtpAddress,
    port: smtpPort,
    secure: true,

    tls: {
        servername: smtpHost
    },

    auth: {
        user: smtpUser,
        pass: smtpPassword
    },

    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
});

    const result = await transporter.sendMail({
        from: emailFrom,
        to: email,
        subject: "InfraSight Email Verification",

        text:
            "Your InfraSight verification code is: " + code + "\n\n"
    });

    if (result.accepted.length === 0) {
        throw new Error("The mail server did not accept the recipient");
    }

    return result.messageId;
}