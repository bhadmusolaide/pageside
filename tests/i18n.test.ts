import test from 'node:test';
import assert from 'node:assert/strict';
import { getUiLocale, setUiLocale, supportedLocales, t } from '../src/lib/i18n.ts';

test('options strings are translated and interpolate values in Spanish', () => {
  setUiLocale('es');
  assert.equal(t('vault.addItem'), 'Añadir elemento');
  assert.equal(t('history.page', { page: 2, total: 5 }), 'Página 2 de 5');
  assert.equal(t('settings.itemCount', { count: 3 }), '3 elementos');
  setUiLocale('en');
});

test('unsupported interface languages fall back to English', () => {
  setUiLocale('fr');
  assert.equal(getUiLocale(), 'en');
  assert.equal(t('profiles.title'), 'Site Profiles');
  assert.deepEqual(supportedLocales(), ['en', 'es']);
});
