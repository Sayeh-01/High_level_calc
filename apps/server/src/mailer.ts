import nodemailer from 'nodemailer';

export interface Mailer {
  sendOtp(email: string, otp: string): Promise<void>;
  /** Dev/test only: the last code sent to an address. */
  lastOtp?(email: string): string | undefined;
}

/** Dev driver: prints codes to the console and remembers them for the test-only route. */
export function createDevMailer(log = true): Mailer {
  const codes = new Map<string, string>();
  return {
    async sendOtp(email, otp) {
      codes.set(email.toLowerCase(), otp);
      if (log) console.log(`[dev-mailer] sign-in code for ${email}: ${otp}`);
    },
    lastOtp: (email) => codes.get(email.toLowerCase()),
  };
}

/** Real driver: any SMTP server (e.g. Resend's SMTP relay). */
export function createSmtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async sendOtp(email, otp) {
      await transport.sendMail({
        from,
        to: email,
        subject: `Circle sign-in code: ${otp}`,
        text: `Your Circle code is ${otp}. It expires in 5 minutes.\n\nكود الدخول إلى Circle هو ${otp}. ينتهي خلال ٥ دقائق.`,
      });
    },
  };
}
