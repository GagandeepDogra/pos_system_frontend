/** Registers the service worker that precaches the app shell (offline launch). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Plain-HTTP LAN without a trusted certificate: the app still works as a website.
    });
  });
}
