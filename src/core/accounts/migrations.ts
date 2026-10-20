import { createInitialState, isRecord, parseStateV1 } from './schema';
import type { State } from './types';

/**
 * Storage schema versioning.
 *
 * To change the persisted shape:
 * 1. bump CURRENT_SCHEMA_VERSION and add `StateVn` in types.ts;
 * 2. add `migrations[n - 1]`, a pure function from the version n-1 shape to
 *    the version n shape (it must set `schemaVersion: n`);
 * 3. point the final parse step at the new version;
 * 4. add a fixture-based test for the migration.
 */
export const CURRENT_SCHEMA_VERSION = 1;

export type RawState = Record<string, unknown>;

/** `migrations[n]` upgrades a version-n state to version n+1. */
export type MigrationTable = Readonly<Record<number, (state: RawState) => RawState>>;

export const migrations: MigrationTable = {};

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** Applies migrations until `targetVersion`, without parsing the result. */
export function runMigrations(
  state: RawState,
  table: MigrationTable,
  targetVersion: number,
): RawState {
  const startVersion = state.schemaVersion;
  if (typeof startVersion !== 'number' || !Number.isInteger(startVersion) || startVersion < 1) {
    throw new SchemaError('Stored state has no valid schema version');
  }
  if (startVersion > targetVersion) {
    throw new SchemaError(
      `Stored state version ${startVersion} is newer than supported version ${targetVersion}`,
    );
  }
  let current = state;
  for (let version = startVersion; version < targetVersion; version += 1) {
    const migration = table[version];
    if (migration === undefined) throw new SchemaError(`Missing migration from version ${version}`);
    current = migration(current);
    if (current.schemaVersion !== version + 1) {
      throw new SchemaError(
        `Migration from version ${version} did not produce version ${version + 1}`,
      );
    }
  }
  return current;
}

/**
 * Turns whatever is in storage into a current-version state. An empty storage
 * yields the initial state. Throws SchemaError when the data cannot be read.
 */
export function migrateState(raw: unknown, table: MigrationTable = migrations): State {
  if (raw === undefined || raw === null) return createInitialState();
  if (!isRecord(raw)) throw new SchemaError('Stored state is not an object');
  return parseStateV1(runMigrations(raw, table, CURRENT_SCHEMA_VERSION));
}
