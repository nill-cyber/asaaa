export type Theme = "light" | "dark" | "auto";
const KEY = "tfuel_theme";
export function getTheme(): Theme {
  try { const v = localStorage.getItem(KEY); return v === "dark" || v === "auto" ? v : "light"; } catch { return "light"; }
}
export function applyTheme(t: Theme = getTheme()) {
  if (typeof document === "undefined") return;
  let dark = t === "dark";
  if (t === "auto") {
    const tg = (window as any).Telegram?.WebApp?.colorScheme;
    dark = tg ? tg === "dark" : !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  }
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch {}
  applyTheme(t);
}
