import { normalizeSameSite } from '../cookies/serialization';
import type { CookiePartitionKey, StoredCookie } from '../cookies/types';
import {
  DEFAULT_SETTINGS,
  type Account,
  type AccountIdentity,
  type PendingLogin,
  type PendingSwitch,
  type Settings,
  type StateV1,
} from './types';

/**
 * Defensive parsing of persisted state. Storage is written only by this
 * extension, but a parse that drops malformed entries is cheaper than a crash
 * that locks the user out of every saved account.
 */

type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
export const MAX_DISMISSED_SESSIONS = 20;
const MAX_EMAIL_LENGTH = 320;
const MAX_NAME_LENGTH = 200;

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isString(value) && value !== '' && value.length <= maxLength;
}

export function createInitialState(): StateV1 {
  return {
    schemaVersion: 1,
    accounts: [],
    pendingLogins: {},
    pendingSwitches: {},
    dismissedSessions: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function parsePartitionKey(value: unknown): CookiePartitionKey | undefined {
  if (!isRecord(value) || !isString(value.topLevelSite) || value.topLevelSite === '') {
    return undefined;
  }
  const key: CookiePartitionKey = { topLevelSite: value.topLevelSite };
  if (isBoolean(value.hasCrossSiteAncestor)) key.hasCrossSiteAncestor = value.hasCrossSiteAncestor;
  return key;
}

export function parseStoredCookie(value: unknown): StoredCookie | undefined {
  if (!isRecord(value)) return undefined;
  const { name, value: cookieValue, domain, path, hostOnly, secure, httpOnly, session } = value;
  if (!isString(name) || !isString(cookieValue) || !isString(domain) || !isString(path)) {
    return undefined;
  }
  if (!isBoolean(hostOnly) || !isBoolean(secure) || !isBoolean(httpOnly) || !isBoolean(session)) {
    return undefined;
  }
  const cookie: StoredCookie = {
    name,
    value: cookieValue,
    domain,
    hostOnly,
    path,
    secure,
    httpOnly,
    sameSite: normalizeSameSite(isString(value.sameSite) ? value.sameSite : undefined),
    session,
  };
  if (!session && isNumber(value.expirationDate)) cookie.expirationDate = value.expirationDate;
  const partitionKey = parsePartitionKey(value.partitionKey);
  if (partitionKey !== undefined) cookie.partitionKey = partitionKey;
  if (isString(value.firstPartyDomain)) cookie.firstPartyDomain = value.firstPartyDomain;
  return cookie;
}

export function parseIdentity(value: unknown): AccountIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const identity: AccountIdentity = {};
  if (isBoundedString(value.email, MAX_EMAIL_LENGTH)) identity.email = value.email;
  if (isBoundedString(value.name, MAX_NAME_LENGTH)) identity.name = value.name;
  return identity.email === undefined && identity.name === undefined ? undefined : identity;
}

function parseAccount(value: unknown): Account | undefined {
  if (!isRecord(value)) return undefined;
  const { id, label, createdAt, savedAt, cookies } = value;
  if (!isString(id) || id === '' || !isString(label) || !Array.isArray(cookies)) return undefined;
  const account: Account = {
    id,
    label,
    status: value.status === 'expired' ? 'expired' : 'ok',
    cookies: cookies.map(parseStoredCookie).filter((cookie) => cookie !== undefined),
    createdAt: isNumber(createdAt) ? createdAt : 0,
    savedAt: isNumber(savedAt) ? savedAt : 0,
  };
  const identity = parseIdentity(value.identity);
  if (identity !== undefined) account.identity = identity;
  return account;
}

function parseSettings(value: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!isRecord(value)) return settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const candidate = value[key];
    if (isBoolean(candidate)) settings[key] = candidate;
  }
  return settings;
}

function parseRecord<T>(
  value: unknown,
  parseEntry: (entry: unknown) => T | undefined,
): Record<string, T> {
  const result: Record<string, T> = {};
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseEntry(entry);
    if (parsed !== undefined) result[key] = parsed;
  }
  return result;
}

function parsePendingLogin(value: unknown): PendingLogin | undefined {
  if (!isRecord(value) || !isNumber(value.startedAt)) return undefined;
  const pending: PendingLogin = { startedAt: value.startedAt };
  if (isString(value.resaveAccountId)) pending.resaveAccountId = value.resaveAccountId;
  return pending;
}

function parsePendingSwitch(value: unknown): PendingSwitch | undefined {
  if (!isRecord(value) || !isNumber(value.startedAt) || !isString(value.accountId)) {
    return undefined;
  }
  return { accountId: value.accountId, startedAt: value.startedAt };
}

/** Parses a value already migrated to schema version 1. */
export function parseStateV1(value: UnknownRecord): StateV1 {
  const accounts: Account[] = [];
  const accountIds = new Set<string>();
  for (const entry of Array.isArray(value.accounts) ? value.accounts : []) {
    const account = parseAccount(entry);
    if (account === undefined || accountIds.has(account.id)) continue;
    accountIds.add(account.id);
    accounts.push(account);
  }
  const pendingSwitches = parseRecord(value.pendingSwitches, (entry) => {
    const pending = parsePendingSwitch(entry);
    return pending !== undefined && accountIds.has(pending.accountId) ? pending : undefined;
  });
  return {
    schemaVersion: 1,
    accounts,
    pendingLogins: parseRecord(value.pendingLogins, parsePendingLogin),
    pendingSwitches,
    dismissedSessions: (Array.isArray(value.dismissedSessions) ? value.dismissedSessions : [])
      .filter((entry): entry is string => isString(entry) && FINGERPRINT_PATTERN.test(entry))
      .slice(-MAX_DISMISSED_SESSIONS),
    settings: parseSettings(value.settings),
  };
}
