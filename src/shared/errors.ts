/** Error codes that cross context boundaries (background → popup/content). */
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'SWITCH_FAILED'
  | 'ROLLBACK_FAILED'
  | 'UNKNOWN';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

const ERROR_CODES: readonly ErrorCode[] = [
  'INVALID_REQUEST',
  'NOT_FOUND',
  'SESSION_EXPIRED',
  'SWITCH_FAILED',
  'ROLLBACK_FAILED',
  'UNKNOWN',
];

/** User-facing messages, kept in one place so every surface says the same thing. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: 'The request was not understood.',
  NOT_FOUND: 'This account no longer exists.',
  SESSION_EXPIRED: 'This saved session has expired. Log in to this account again to update it.',
  SWITCH_FAILED: 'Switching failed. Your previous session was restored.',
  ROLLBACK_FAILED: 'Switching failed and the previous session could not be restored. Log in again.',
  UNKNOWN: 'Something went wrong.',
};

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = ERROR_MESSAGES[code], options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return ERROR_CODES.includes(value as ErrorCode);
}

/** Serializes any thrown value for messaging. Unknown errors never leak details. */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'UNKNOWN', message: ERROR_MESSAGES.UNKNOWN };
}
