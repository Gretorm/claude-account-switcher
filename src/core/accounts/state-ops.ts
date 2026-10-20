import { AppError } from '../../shared/errors';
import { MAX_DISMISSED_SESSIONS } from './schema';
import type { Account, State } from './types';

export const MAX_LABEL_LENGTH = 80;

/** Trims a user-given label and rejects empty or oversized ones. */
export function normalizeLabel(label: string): string {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (normalized === '' || normalized.length > MAX_LABEL_LENGTH) {
    throw new AppError('INVALID_REQUEST', `Labels must be 1 to ${MAX_LABEL_LENGTH} characters.`);
  }
  return normalized;
}

export function requireAccount(state: State, accountId: string): Account {
  const account = state.accounts.find((candidate) => candidate.id === accountId);
  if (account === undefined) throw new AppError('NOT_FOUND');
  return account;
}

/** Moves an account to `toIndex` (clamped to the list bounds). */
export function moveAccount(state: State, accountId: string, toIndex: number): void {
  const fromIndex = state.accounts.findIndex((account) => account.id === accountId);
  if (fromIndex === -1) throw new AppError('NOT_FOUND');
  const [account] = state.accounts.splice(fromIndex, 1);
  if (account === undefined) return;
  const target = Math.min(Math.max(Math.trunc(toIndex), 0), state.accounts.length);
  state.accounts.splice(target, 0, account);
}

/** Deletes an account and every reference to it. */
export function removeAccount(state: State, accountId: string): void {
  requireAccount(state, accountId);
  state.accounts = state.accounts.filter((account) => account.id !== accountId);
  state.pendingSwitches = Object.fromEntries(
    Object.entries(state.pendingSwitches).filter(([, pending]) => pending.accountId !== accountId),
  );
  for (const pending of Object.values(state.pendingLogins)) {
    if (pending.resaveAccountId === accountId) delete pending.resaveAccountId;
  }
}

/** Remembers session fingerprints, keeping only the most recent ones. */
export function dismissSessions(state: State, fingerprints: readonly string[]): void {
  const merged = [...state.dismissedSessions.filter((entry) => !fingerprints.includes(entry))];
  merged.push(...fingerprints);
  state.dismissedSessions = merged.slice(-MAX_DISMISSED_SESSIONS);
}

/** A default label for a new account: its email, else "Account N". */
export function defaultLabel(state: State, email: string | undefined): string {
  if (email !== undefined && email !== '') return email.slice(0, MAX_LABEL_LENGTH);
  return `Account ${state.accounts.length + 1}`;
}
