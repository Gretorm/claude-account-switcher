import { INJECTED_ATTRIBUTE } from './markers';

/**
 * Minimal in-page UI (dialogs and toasts), rendered in a closed shadow root so
 * the site's styles and scripts cannot reach into it, and vice versa.
 */

const STYLES = `
:host { all: initial; }
.surface {
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1f1f1f;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
dialog { padding: 20px; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; }
dialog::backdrop { background: rgba(0, 0, 0, 0.35); }
h2 { font-size: 16px; margin: 0 0 8px; }
p { margin: 0 0 14px; color: #4a4a4a; }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
button {
  font: inherit; padding: 7px 14px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(0, 0, 0, 0.18); background: #f4f4f2; color: inherit;
}
button.primary { background: #1f4e5f; border-color: #1f4e5f; color: #fff; }
button.danger { background: #dc2626; border-color: #dc2626; color: #fff; }
button:focus-visible { outline: 2px solid #2d7a92; outline-offset: 2px; }
.toast {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  max-width: min(420px, calc(100vw - 32px)); padding: 12px 14px;
  display: flex; gap: 12px; align-items: flex-start;
}
.toast[data-kind="error"] { border-color: #d92d20; }
.toast button { padding: 2px 8px; }
@media (prefers-color-scheme: dark) {
  .surface { color: #ececec; background: #2b2b29; border-color: rgba(255, 255, 255, 0.14); }
  p { color: #c4c4c4; }
  button { background: #3a3a37; border-color: rgba(255, 255, 255, 0.18); }
  button.primary { background: #3c8ea8; border-color: #3c8ea8; color: #0f1a1e; }
}
`;

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  primary?: boolean;
  /** A destructive action, shown in red. */
  danger?: boolean;
}

export class PageUi {
  private root: ShadowRoot | undefined;
  private host: HTMLElement | undefined;

  constructor(private readonly document: Document) {}

  /** Asks the user to pick one of several options. Resolves to `null` when dismissed. */
  async choose<T extends string>(options: {
    title: string;
    message: string;
    choices: ChoiceOption<T>[];
  }): Promise<T | null> {
    const dialog = this.createDialog(options.title, options.message);
    const form = this.document.createElement('form');
    form.method = 'dialog';
    form.append(this.actions([{ value: 'cancel', label: 'Cancel' }, ...options.choices]));
    dialog.append(form);
    const result = await this.show(dialog);
    return options.choices.find((choice) => choice.value === result)?.value ?? null;
  }

  /** Shows a dismissible notice in the corner of the page. */
  toast(message: string, kind: 'info' | 'error' = 'info', durationMs = 8000): void {
    const toast = this.document.createElement('div');
    toast.className = 'surface toast';
    toast.dataset.kind = kind;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const text = this.document.createElement('span');
    text.textContent = message;
    const close = this.document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', () => {
      toast.remove();
    });
    toast.append(text, close);
    this.shadow().append(toast);
    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  destroy(): void {
    this.host?.remove();
    this.host = undefined;
    this.root = undefined;
  }

  private shadow(): ShadowRoot {
    if (this.root !== undefined && this.host?.isConnected === true) return this.root;
    const host = this.document.createElement('div');
    host.setAttribute(INJECTED_ATTRIBUTE, 'ui');
    const root = host.attachShadow({ mode: 'closed' });
    const style = this.document.createElement('style');
    style.textContent = STYLES;
    root.append(style);
    this.document.documentElement.append(host);
    this.host = host;
    this.root = root;
    return root;
  }

  private createDialog(title: string, message: string): HTMLDialogElement {
    const dialog = this.document.createElement('dialog');
    dialog.className = 'surface';
    const heading = this.document.createElement('h2');
    heading.textContent = title;
    const body = this.document.createElement('p');
    body.textContent = message;
    dialog.append(heading, body);
    return dialog;
  }

  private actions(choices: ChoiceOption<string>[]): HTMLElement {
    const actions = this.document.createElement('div');
    actions.className = 'actions';
    for (const choice of choices) {
      const button = this.document.createElement('button');
      button.value = choice.value;
      button.textContent = choice.label;
      if (choice.danger === true) button.className = 'danger';
      else if (choice.primary === true) button.className = 'primary';
      actions.append(button);
    }
    return actions;
  }

  private show(dialog: HTMLDialogElement): Promise<string> {
    this.shadow().append(dialog);
    return new Promise((resolve) => {
      dialog.addEventListener(
        'close',
        () => {
          dialog.remove();
          resolve(dialog.returnValue);
        },
        { once: true },
      );
      dialog.showModal();
    });
  }
}
