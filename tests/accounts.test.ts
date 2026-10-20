import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AccountRepository,
  BACKUP_KEY_PREFIX,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  STATE_KEY,
  SchemaError,
  createInitialState,
  defaultLabel,
  fromStorageArea,
  migrateState,
  moveAccount,
  normalizeLabel,
  removeAccount,
  runMigrations,
  type Account,
  type MigrationTable,
  type State,
} from '../src/core/accounts';
import { AppError } from '../src/shared/errors';

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, label: id, status: 'ok', cookies: [], createdAt: 1, savedAt: 1, ...overrides };
}

function stateWith(...accounts: Account[]): State {
  return { ...createInitialState(), accounts };
}

describe('migrateState', () => {
  it('starts from the initial state when storage is empty', () => {
    expect(migrateState(undefined)).toEqual(createInitialState());
    expect(createInitialState().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('parses a valid current state', () => {
    const state = stateWith(account('a', { identity: { email: 'a@example.com' } }));
    state.pendingSwitches.default = { accountId: 'a', startedAt: 5 };
    expect(migrateState(structuredClone(state))).toEqual(state);
  });

  it('drops malformed entries instead of failing', () => {
    const result = migrateState({
      schemaVersion: 1,
      accounts: [
        account('a', {
          cookies: [
            { name: 'broken' } as never,
            {
              name: 'ok',
              value: '1',
              domain: 'claude.ai',
              hostOnly: true,
              path: '/',
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
              session: true,
            },
          ],
        }),
        { id: 42 },
        account('a'),
      ],
      pendingSwitches: { default: { accountId: 'deleted', startedAt: 1 } },
      settings: { debug: true, injectIntoMenu: 'yes', unknown: true },
    });
    expect(result.accounts.map((entry) => entry.id)).toEqual(['a']);
    expect(result.accounts[0]?.cookies.map((cookie) => cookie.name)).toEqual(['ok']);
    expect(result.pendingSwitches).toEqual({});
    expect(result.settings).toEqual({ ...DEFAULT_SETTINGS, debug: true });
  });

  it('rejects data that is not a versioned state', () => {
    expect(() => migrateState('nope')).toThrow(SchemaError);
    expect(() => migrateState({ accounts: [] })).toThrow(SchemaError);
  });

  it('refuses to downgrade a state written by a newer version', () => {
    expect(() => migrateState({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(SchemaError);
  });
});

describe('runMigrations', () => {
  const table: MigrationTable = {
    1: (state) => ({ ...state, schemaVersion: 2, renamed: state.original }),
    2: (state) => ({ ...state, schemaVersion: 3, extra: true }),
  };

  it('applies every step in order', () => {
    expect(runMigrations({ schemaVersion: 1, original: 'x' }, table, 3)).toEqual({
      schemaVersion: 3,
      original: 'x',
      renamed: 'x',
      extra: true,
    });
  });

  it('starts from the stored version', () => {
    expect(runMigrations({ schemaVersion: 2 }, table, 3)).toEqual({
      schemaVersion: 3,
      extra: true,
    });
  });

  it('fails on a gap in the migration table', () => {
    expect(() => runMigrations({ schemaVersion: 1 }, { 2: table[2] as never }, 3)).toThrow(
      'Missing migration from version 1',
    );
  });

  it('fails when a migration forgets to bump the version', () => {
    expect(() => runMigrations({ schemaVersion: 1 }, { 1: (state) => state }, 2)).toThrow(
      SchemaError,
    );
  });
});

describe('AccountRepository', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  const repository = () =>
    new AccountRepository(fromStorageArea(fakeBrowser.storage.local), { now: () => 1234 });

  it('persists updates in storage.local under one versioned key', async () => {
    await repository().update((state) => {
      state.accounts.push(account('a'));
    });
    const stored = (await fakeBrowser.storage.local.get(STATE_KEY))[STATE_KEY] as State;
    expect(stored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(stored.accounts.map((entry) => entry.id)).toEqual(['a']);
    expect((await repository().read()).accounts).toHaveLength(1);
  });

  it('serializes concurrent updates so none is lost', async () => {
    const repo = repository();
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((id) =>
        repo.update((state) => {
          state.accounts.push(account(id));
        }),
      ),
    );
    expect((await repo.read()).accounts.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('discards a mutation that throws', async () => {
    const repo = repository();
    await expect(
      repo.update((state) => {
        state.accounts.push(account('a'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await repo.read()).accounts).toEqual([]);
  });

  it('backs up an unreadable state before starting over', async () => {
    await fakeBrowser.storage.local.set({ [STATE_KEY]: { schemaVersion: 99, accounts: ['x'] } });
    const state = await repository().read();
    expect(state).toEqual(createInitialState());
    const backup = await fakeBrowser.storage.local.get(`${BACKUP_KEY_PREFIX}1234`);
    expect(backup[`${BACKUP_KEY_PREFIX}1234`]).toEqual({ schemaVersion: 99, accounts: ['x'] });
  });
});

describe('state operations', () => {
  it('normalizes labels and rejects empty or oversized ones', () => {
    expect(normalizeLabel('  Work \n account ')).toBe('Work account');
    expect(() => normalizeLabel('   ')).toThrow(AppError);
    expect(() => normalizeLabel('x'.repeat(81))).toThrow(AppError);
  });

  it('moves accounts within bounds', () => {
    const state = stateWith(account('a'), account('b'), account('c'));
    moveAccount(state, 'c', 0);
    expect(state.accounts.map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    moveAccount(state, 'c', 99);
    expect(state.accounts.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(() => {
      moveAccount(state, 'missing', 0);
    }).toThrow(AppError);
  });

  it('removes an account and every reference to it', () => {
    const state = stateWith(account('a'), account('b'));
    state.pendingSwitches.default = { accountId: 'a', startedAt: 1 };
    state.pendingLogins.default = { startedAt: 1, resaveAccountId: 'a' };
    removeAccount(state, 'a');
    expect(state.accounts.map((entry) => entry.id)).toEqual(['b']);
    expect(state.pendingSwitches).toEqual({});
    expect(state.pendingLogins.default).toEqual({ startedAt: 1 });
  });

  it('derives a default label from the email', () => {
    expect(defaultLabel(stateWith(), 'me@example.com')).toBe('me@example.com');
    expect(defaultLabel(stateWith(account('a')), undefined)).toBe('Account 2');
  });
});
