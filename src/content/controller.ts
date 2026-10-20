import { describeIdentity } from '../core/identity';
import type { PageReport, ViewState } from '../core/switcher/types';
import { AppError, ERROR_MESSAGES } from '../shared/errors';
import { silentLogger, type Logger } from '../shared/logger';
import type { BackgroundRequests, RequestOf, ResponseOf } from '../shared/messaging';
import type { MenuAction, MenuInjector, MenuModel } from './menu-injector';
import type { PageUi } from './ui';

export interface BackgroundClient {
  request<K extends keyof BackgroundRequests>(
    type: K,
    payload: RequestOf<BackgroundRequests, K>,
  ): Promise<ResponseOf<BackgroundRequests, K>>;
}

export interface ContentControllerDeps {
  client: BackgroundClient;
  ui: PageUi;
  probe: () => Promise<PageReport>;
  createInjector: (handlers: {
    onAction: (action: MenuAction) => void;
    onMenuOpen: () => void;
  }) => MenuInjector;
  logger?: Logger;
}

export function toMenuModel(state: ViewState): MenuModel {
  return {
    accounts: state.accounts.map((account) => {
      const detail = describeIdentity(account.identity);
      return {
        id: account.id,
        label: account.label,
        ...(detail === undefined ? {} : { detail }),
        active: account.active,
        expired: account.status === 'expired',
      };
    }),
  };
}

/** Orchestrates the in-page features: probe, automatic saving, menu and dialogs. */
export class ContentController {
  private readonly logger: Logger;
  private injector: MenuInjector | undefined;
  private state: ViewState | undefined;
  private busy = false;
  private syncing: Promise<ViewState> | undefined;

  constructor(private readonly deps: ContentControllerDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  async start(): Promise<void> {
    const state = await this.sync();
    if (state.settings.injectIntoMenu) {
      this.injector = this.deps.createInjector({
        onAction: (action) => {
          void this.handleAction(action);
        },
        // The site signs in without reloading the page: check again on every open.
        onMenuOpen: () => {
          void this.sync().catch((error: unknown) => {
            this.logger.debug('Could not refresh the menu', error);
          });
        },
      });
      this.injector.setModel(toMenuModel(state));
      this.injector.start();
    }
  }

  /**
   * Reports the page to the background, which saves a signed-in session
   * automatically, then refreshes the view. Concurrent calls share one run.
   */
  sync(): Promise<ViewState> {
    this.syncing ??= this.runSync().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }

  private async runSync(): Promise<ViewState> {
    const report = await this.deps.probe();
    const { expiredAccountLabel, savedAccount } = await this.deps.client.request(
      'reportPageState',
      report,
    );
    if (expiredAccountLabel !== undefined) {
      this.deps.ui.toast(
        `The saved session for "${expiredAccountLabel}" has expired. Log in to that account again: it will be updated automatically.`,
        'error',
        15_000,
      );
    } else if (savedAccount !== undefined) {
      this.deps.ui.toast(
        savedAccount.created
          ? `Account "${savedAccount.label}" saved.`
          : `Account "${savedAccount.label}" updated.`,
      );
    }
    return this.refresh();
  }

  stop(): void {
    this.injector?.stop();
    this.injector = undefined;
    this.deps.ui.destroy();
  }

  async refresh(): Promise<ViewState> {
    const state = await this.deps.client.request('getState', {});
    this.state = state;
    this.injector?.setModel(toMenuModel(state));
    return state;
  }

  async handleAction(action: MenuAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (action.type === 'switch') await this.switchTo(action.accountId);
      else if (action.type === 'delete') await this.deleteAccount(action.accountId);
      else await this.deps.client.request('beginLogin', {});
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy = false;
    }
  }

  private async switchTo(accountId: string): Promise<void> {
    const account = this.state?.accounts.find((candidate) => candidate.id === accountId);
    const label = account?.label ?? 'this account';
    if (account?.status === 'expired') {
      await this.offerRelogin(accountId, label);
      return;
    }
    try {
      const { switched } = await this.deps.client.request('switchAccount', { accountId });
      if (!switched) this.deps.ui.toast(`You are already using "${label}".`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'SESSION_EXPIRED') {
        await this.offerRelogin(accountId, label);
        return;
      }
      throw error;
    }
  }

  private async deleteAccount(accountId: string): Promise<void> {
    const account = this.state?.accounts.find((candidate) => candidate.id === accountId);
    if (account === undefined) return;
    const choice = await this.deps.ui.choose({
      title: `Delete "${account.label}"?`,
      message: account.active
        ? 'Its saved session will be erased from this browser. You stay signed in, but this session will not be saved again; sign in again to add the account back.'
        : 'Its saved session will be erased from this browser. You can add the account again later by signing in to it.',
      choices: [{ value: 'delete', label: 'Delete', danger: true }],
    });
    if (choice !== 'delete') return;
    await this.deps.client.request('deleteAccount', { accountId });
    this.deps.ui.toast(`Account "${account.label}" deleted.`);
    await this.refresh();
  }

  private async offerRelogin(accountId: string, label: string): Promise<void> {
    const choice = await this.deps.ui.choose({
      title: 'Session expired',
      message: `The saved session for "${label}" is no longer valid. Log in to that account again to update it.`,
      choices: [{ value: 'login', label: 'Log in again', primary: true }],
    });
    if (choice !== 'login') return;
    await this.deps.client.request('beginLogin', { resaveAccountId: accountId });
  }

  private showError(error: unknown): void {
    this.logger.debug('Action failed', error);
    this.deps.ui.toast(error instanceof AppError ? error.message : ERROR_MESSAGES.UNKNOWN, 'error');
  }
}
