/**
 * The owner's account vocabulary (2026-10-28), shared by every connected
 * account across channels (Threads, WhatsApp, Telegram, email…): who runs it,
 * a human or our AI, and whether it is a professional or a personal presence.
 */
export const ACCOUNT_TYPES = {
  pro_human: "Pro (human)",
  personal_human: "Personal (human)",
  pro_ai: "Pro (AI)",
} as const;

export type AccountType = keyof typeof ACCOUNT_TYPES;

export const ACCOUNT_TYPE_VALUES = Object.keys(ACCOUNT_TYPES) as [
  AccountType,
  ...AccountType[],
];
