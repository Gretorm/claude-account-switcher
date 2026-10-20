import type { AccountIdentity } from '../accounts/types';

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const EMAIL_KEYS = ['email_address', 'email', 'emailAddress'];
const NAME_KEYS = ['full_name', 'display_name', 'fullName', 'displayName', 'name'];
const MAX_DEPTH = 4;
const MAX_NODES = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/**
 * Finds the signed-in account in an arbitrary JSON payload, without relying on
 * its exact shape: a breadth-first search for the shallowest object that has
 * an email-like field, taking the name from the same object.
 */
export function extractIdentity(payload: unknown): AccountIdentity | undefined {
  const queue: { value: unknown; depth: number }[] = [{ value: payload, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_NODES) {
    const next = queue.shift();
    if (next === undefined) break;
    visited += 1;
    const { value, depth } = next;
    const children = Array.isArray(value)
      ? value
      : isPlainObject(value)
        ? Object.values(value)
        : [];
    if (isPlainObject(value)) {
      const email = firstString(value, EMAIL_KEYS);
      if (email !== undefined && EMAIL_PATTERN.test(email)) {
        const identity: AccountIdentity = { email };
        const name = firstString(value, NAME_KEYS);
        if (name !== undefined) identity.name = name;
        return identity;
      }
    }
    if (depth < MAX_DEPTH) {
      for (const child of children) {
        if (typeof child === 'object' && child !== null)
          queue.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return undefined;
}

/** Returns the first email address found in free text. */
export function findEmailInText(text: string): string | undefined {
  return EMAIL_PATTERN.exec(text)?.[0];
}

export function sameEmail(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Human-readable secondary line for an account. */
export function describeIdentity(identity: AccountIdentity | undefined): string | undefined {
  return identity?.email ?? identity?.name;
}
