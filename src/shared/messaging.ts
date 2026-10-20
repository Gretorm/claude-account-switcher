import type { Settings } from '../core/accounts/types';
import type { PageReport, ViewState } from '../core/switcher/types';
import { AppError, isErrorCode, toErrorPayload, type ErrorPayload } from './errors';

/**
 * Typed message contracts. Every message carries a channel marker so foreign
 * messages are ignored, and every payload is validated by the receiver: the
 * background never trusts what a content script sends.
 */

const CHANNEL = 'menu-account-switcher';

/** Requests handled by the background. `tabId` is set by the popup only. */
export interface BackgroundRequests {
  getState: { request: { tabId?: number }; response: ViewState };
  beginLogin: { request: { tabId?: number; resaveAccountId?: string }; response: null };
  switchAccount: {
    request: { tabId?: number; accountId: string };
    response: { switched: boolean };
  };
  renameAccount: { request: { accountId: string; label: string }; response: null };
  moveAccount: { request: { accountId: string; toIndex: number }; response: null };
  deleteAccount: { request: { tabId?: number; accountId: string }; response: null };
  updateSettings: { request: Partial<Settings>; response: Settings };
  reportPageState: {
    request: PageReport;
    response: {
      expiredAccountLabel?: string;
      /** The live session was just saved automatically. */
      savedAccount?: { label: string; created: boolean };
    };
  };
}

/** Commands sent by the background to the content script of a tab. */
export interface ContentCommands {
  clearSiteStorage: { request: { all: boolean }; response: null };
  probePage: { request: Record<string, never>; response: PageReport };
  /** A session cookie appeared: report the page again (sign-ins do not reload it). */
  syncSession: { request: Record<string, never>; response: null };
}

type Contracts = BackgroundRequests | ContentCommands;
export type RequestOf<C extends Contracts, K extends keyof C> = C[K] extends { request: infer R }
  ? R
  : never;
export type ResponseOf<C extends Contracts, K extends keyof C> = C[K] extends { response: infer R }
  ? R
  : never;

export interface Envelope<K extends string = string> {
  channel: typeof CHANNEL;
  type: K;
  payload: unknown;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: ErrorPayload };

export function createEnvelope<K extends string>(type: K, payload: unknown): Envelope<K> {
  return { channel: CHANNEL, type, payload };
}

export function isEnvelope(message: unknown): message is Envelope {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<Envelope>).channel === CHANNEL &&
    typeof (message as Partial<Envelope>).type === 'string'
  );
}

/** Unwraps a reply, turning an error reply back into an AppError. */
// The caller names the expected data type, which a reply cannot prove at runtime.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function unwrapReply<T>(reply: unknown): T {
  if (typeof reply !== 'object' || reply === null || !('ok' in reply)) {
    throw new AppError('UNKNOWN', 'No response from the extension.');
  }
  const typed = reply as Reply<T>;
  if (typed.ok) return typed.data;
  const code = isErrorCode(typed.error.code) ? typed.error.code : 'UNKNOWN';
  throw new AppError(code, typed.error.message);
}

export type Handlers<C extends Contracts, Ctx> = {
  [K in keyof C]: (payload: RequestOf<C, K>, context: Ctx) => Promise<ResponseOf<C, K>>;
};

export type Validators<C extends Contracts> = {
  [K in keyof C]: (payload: unknown) => RequestOf<C, K>;
};

/**
 * Dispatches a validated envelope to its handler and wraps the outcome in a
 * Reply. Unknown message types and invalid payloads become INVALID_REQUEST.
 */
export async function dispatch<C extends Contracts, Ctx>(
  envelope: Envelope,
  handlers: Handlers<C, Ctx>,
  validators: Validators<C>,
  context: Ctx,
): Promise<Reply<unknown>> {
  try {
    if (!Object.hasOwn(handlers, envelope.type)) throw new AppError('INVALID_REQUEST');
    const type = envelope.type as keyof C & string;
    const payload = validators[type](envelope.payload);
    const data = await handlers[type](payload, context);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorPayload(error) };
  }
}

// ---------------------------------------------------------------------------
// Payload validation helpers

function invalid(): never {
  throw new AppError('INVALID_REQUEST');
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

const MAX_TEXT = 500;

export function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '' || value.length > MAX_TEXT) invalid();
  return value;
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return record[key] === undefined ? undefined : requiredString(record, key);
}

export function requiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) invalid();
  return value;
}

export function optionalInteger(record: Record<string, unknown>, key: string): number | undefined {
  return record[key] === undefined ? undefined : requiredInteger(record, key);
}

/** Copies only the defined optional fields, as exactOptionalPropertyTypes requires. */
export function definedFields<T extends Record<string, unknown>>(
  fields: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const result: { [K in keyof T]?: Exclude<T[K], undefined> } = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const value = fields[key];
    if (value !== undefined) result[key] = value as Exclude<T[keyof T], undefined>;
  }
  return result;
}
