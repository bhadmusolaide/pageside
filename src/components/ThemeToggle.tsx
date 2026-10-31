import { useSyncExternalStore } from 'react';
import { getThemeMode, isDark, setTheme, subscribeTheme } from '../lib/theme';
import { getUiLocale, subscribeLocale, t } from '../lib/i18n';

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribeTheme, getThemeMode, getThemeMode);
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);
  const dark = isDark(mode);

  return (
    <button
      type="button"
      className="px-2.5 py-1.5 text-xs font-medium rounded border border-gray-400 bg-white text-gray-700 hover:bg-gray-100 min-h-[32px]"
      aria-pressed={dark}
      title={dark ? t('theme.light') : t('theme.dark')}
      onClick={() => void setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? t('theme.light') : t('theme.dark')}
    </button>
  );
}

export default ThemeToggle;
