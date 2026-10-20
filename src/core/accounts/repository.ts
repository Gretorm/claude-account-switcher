import { SerialQueue } from '../../shared/serial-queue';
import { migrateState, SchemaError } from './migrations';
import { createInitialState } from './schema';
import type { State } from './types';

/** The single `storage.local` key holding the versioned state. */
export const STATE_KEY = 'state';
/** Prefix of keys holding unreadable states, kept so nothing is silently lost. */
export const BACKUP_KEY_PREFIX = 'state.unreadable.';

export interface KeyValueStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** The subset of `browser.storage.local` the repository needs. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function fromStorageArea(area: StorageAreaLike): KeyValueStorage {
  return {
    get: async (key) => (await area.get(key))[key],
    set: (key, value) => area.set({ [key]: value }),
  };
}

export interface AccountRepositoryOptions {
  now?: () => number;
  onUnreadableState?: (error: SchemaError) => void;
}

/**
 * Persists the extension state in one storage key. Every read and write goes
 * through a queue, so concurrent operations in the background context can
 * never interleave a read-modify-write and lose an update.
 */
export class AccountRepository {
  private readonly queue = new SerialQueue();
  private readonly now: () => number;
  private readonly onUnreadableState: ((error: SchemaError) => void) | undefined;

  constructor(
    private readonly storage: KeyValueStorage,
    options: AccountRepositoryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onUnreadableState = options.onUnreadableState;
  }

  /** Returns a copy of the current state. */
  read(): Promise<State> {
    return this.queue.run(() => this.load());
  }

  /**
   * Applies `mutate` to a copy of the state and persists it. The mutation is
   * discarded if it throws.
   */
  update<T>(mutate: (state: State) => T): Promise<T> {
    return this.queue.run(async () => {
      const state = await this.load();
      const result = mutate(state);
      await this.storage.set(STATE_KEY, state);
      return result;
    });
  }

  private async load(): Promise<State> {
    const raw = await this.storage.get(STATE_KEY);
    try {
      // Parsing builds fresh objects, so callers never mutate the stored value.
      return migrateState(raw);
    } catch (error) {
      if (!(error instanceof SchemaError)) throw error;
      this.onUnreadableState?.(error);
      await this.storage.set(`${BACKUP_KEY_PREFIX}${this.now()}`, raw);
      const initial = createInitialState();
      await this.storage.set(STATE_KEY, initial);
      return initial;
    }
  }
}
