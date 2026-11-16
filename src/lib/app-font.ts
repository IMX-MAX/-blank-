/**
 * Marks the page with the font that actually loaded, so spacing can suit it: `sf` when the SF Pro files are
 * there, otherwise `inter`.
 */
export function detectAppFont(): void {
  if (typeof document === 'undefined' || !document.fonts) return;
  const root = document.documentElement;
  root.dataset.font = 'inter';
  void Promise.all([document.fonts.load('600 20px "SF Pro Display"'), document.fonts.load('400 15px "SF Pro Text"')])
    .then(([display, text]) => {
      if (display.length && text.length) root.dataset.font = 'sf';
    })
    .catch(() => undefined);
}
