export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'sr-theme';
const DARK_CLASS = 'sr-dark';
const listeners = new Set<() => void>();
let currentMode: ThemeMode = 'system';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function isDark(mode: ThemeMode = currentMode): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark());
}

export function applyTheme(mode: ThemeMode): void {
  currentMode = mode;
  document.documentElement.classList.toggle(DARK_CLASS, isDark(mode));
  document.documentElement.style.colorScheme = isDark(mode) ? 'dark' : 'light';
  listeners.forEach(listener => listener());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export async function initTheme(): Promise<ThemeMode> {
  let mode: ThemeMode = 'system';
  try {
    const stored = await chrome.storage.local.get(THEME_KEY);
    if (isThemeMode(stored[THEME_KEY])) mode = stored[THEME_KEY];
  } catch {
    mode = 'system';
  }
  applyTheme(mode);

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[THEME_KEY]) return;
      const next = changes[THEME_KEY].newValue;
      applyTheme(isThemeMode(next) ? next : 'system');
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentMode === 'system') applyTheme('system');
    });
  } catch {
    /* storage unavailable (e.g. unit tests) */
  }

  return mode;
}

export async function setTheme(mode: ThemeMode): Promise<void> {
  applyTheme(mode);
  try {
    await chrome.storage.local.set({ [THEME_KEY]: mode });
  } catch {
    /* no-op */
  }
}
