/** SMS adapter (B4): a dev driver that logs codes now; a provider (e.g. Twilio, Vonage, a local Egyptian SMS gateway) later. */
export interface SmsSender {
  send(phone: string, text: string, code?: string): Promise<void>;
  lastCode?(phone: string): string | undefined;
}

export function createDevSms(log = true): SmsSender {
  const codes = new Map<string, string>();
  return {
    async send(phone, text, code) {
      if (code) codes.set(phone, code);
      if (log) console.log(`[dev-sms] to ${phone}: ${text}`);
    },
    lastCode: (phone) => codes.get(phone),
  };
}
