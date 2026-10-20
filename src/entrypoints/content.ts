import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContentScript } from '../content';

export default defineContentScript({
  matches: ['https://claude.ai/*'],
  runAt: 'document_idle',
  main(ctx) {
    const stop = startContentScript();
    ctx.onInvalidated(stop);
  },
});
