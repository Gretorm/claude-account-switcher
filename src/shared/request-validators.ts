import { DEFAULT_SETTINGS, type Settings } from '../core/accounts/types';
import { parseIdentity } from '../core/accounts/schema';
import type { PageReport } from '../core/switcher/types';
import {
  asObject,
  definedFields,
  optionalInteger,
  optionalString,
  requiredInteger,
  requiredString,
  type BackgroundRequests,
  type Validators,
} from './messaging';
import { AppError } from './errors';

const settingKeys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Validators for every background request; they reject anything unexpected. */
export const backgroundValidators: Validators<BackgroundRequests> = {
  getState: (payload) => definedFields({ tabId: optionalInteger(asObject(payload), 'tabId') }),
  beginLogin: (payload) => {
    const record = asObject(payload);
    return definedFields({
      tabId: optionalInteger(record, 'tabId'),
      resaveAccountId: optionalString(record, 'resaveAccountId'),
    });
  },
  switchAccount: (payload) => {
    const record = asObject(payload);
    return {
      accountId: requiredString(record, 'accountId'),
      ...definedFields({ tabId: optionalInteger(record, 'tabId') }),
    };
  },
  renameAccount: (payload) => {
    const record = asObject(payload);
    return {
      accountId: requiredString(record, 'accountId'),
      label: requiredString(record, 'label'),
    };
  },
  moveAccount: (payload) => {
    const record = asObject(payload);
    return {
      accountId: requiredString(record, 'accountId'),
      toIndex: requiredInteger(record, 'toIndex'),
    };
  },
  deleteAccount: (payload) => {
    const record = asObject(payload);
    return {
      accountId: requiredString(record, 'accountId'),
      ...definedFields({ tabId: optionalInteger(record, 'tabId') }),
    };
  },
  updateSettings: (payload) => {
    const record = asObject(payload);
    const patch: Partial<Settings> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!settingKeys.includes(key as keyof Settings) || typeof value !== 'boolean') {
        throw new AppError('INVALID_REQUEST');
      }
      patch[key as keyof Settings] = value;
    }
    return patch;
  },
  reportPageState: (payload): PageReport => {
    const record = asObject(payload);
    const { signedIn } = record;
    if (signedIn !== null && typeof signedIn !== 'boolean') throw new AppError('INVALID_REQUEST');
    const report: PageReport = { signedIn };
    const identity = parseIdentity(record.identity);
    if (identity !== undefined) report.identity = identity;
    return report;
  },
};
