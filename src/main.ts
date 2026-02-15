import { initWorkbench } from './app';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWorkbench, { once: true });
} else {
  initWorkbench();
}
