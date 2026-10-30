import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, phoneNumber } from 'better-auth/plugins';
import * as schema from './db/schema';
import type { DB } from './db/client';
import type { Env } from './deps';
import type { Mailer } from './mailer';
import type { SmsSender } from './sms';
import { childPinPlugin } from './routes/children';

export function createAuth(db: DB, env: Env, mailer: Mailer, sms: SmsSender, clock: () => Date = () => new Date()) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema: { users: schema.users, sessions: schema.sessions, accounts: schema.accounts, verifications: schema.verifications },
    }),
    secret: env.authSecret,
    baseURL: env.publicUrl,
    basePath: '/api/auth',
    trustedOrigins: env.trustedOrigins,
    rateLimit: { enabled: env.nodeEnv === 'production' },
    session: { expiresIn: 60 * 60 * 24 * 60, updateAge: 60 * 60 * 24 },
    user: {
      additionalFields: {
        language: { type: 'string', defaultValue: 'en', input: false },
        digits: { type: 'string', defaultValue: 'latn', input: false },
        timezone: { type: 'string', defaultValue: 'Africa/Cairo', input: false },
        isChild: { type: 'boolean', defaultValue: false, input: false },
      },
    },
    socialProviders: {
      ...(env.google ? { google: env.google } : {}),
      ...(env.apple ? { apple: env.apple } : {}),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp }) {
          await mailer.sendOtp(email, otp);
        },
      }),
      // v1.1 phone OTP through the SMS adapter (dev driver logs the code). Phone sign-up gets a placeholder email.
      phoneNumber({
        otpLength: 6,
        expiresIn: 600,
        phoneNumberValidator: (p) => /^\+[1-9]\d{7,14}$/.test(p),
        async sendOTP({ phoneNumber: phone, code }) {
          await sms.send(phone, `Circle code: ${code}`, code);
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone.replace(/\D/g, '')}@phone.circle.invalid`,
          getTempName: () => '',
        },
      }),
      childPinPlugin(db, clock),
      expo(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
