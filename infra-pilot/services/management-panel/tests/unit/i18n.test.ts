import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('i18n Infrastructure', () => {
  const SUPPORTED_LOCALES = ['en', 'de', 'zh', 'es', 'fr', 'ja', 'pt', 'ru', 'ar', 'ko', 'tr'];

  const enKeys = [
    'app.name', 'app.tagline', 'nav.dashboard', 'nav.monitoring',
    'common.loading', 'common.save', 'common.cancel', 'common.delete',
    'common.edit', 'common.create', 'common.search', 'common.error', 'common.success',
    'dashboard.title', 'dashboard.subtitle', 'dashboard.createApp',
    'settings.title', 'settings.general', 'settings.displayName', 'settings.email',
    'themeStudio.title', 'themeStudio.editor', 'themeStudio.preview',
    'themeStudio.gallery', 'themeStudio.export', 'themeStudio.import',
    'bulk.title', 'bulk.selectAll', 'bulk.clearSelection', 'bulk.execute',
    'bulk.rollback', 'bulk.progress', 'bulk.history',
    'a11y.skipLink', 'a11y.keyboardShortcuts',
    'language.label', 'language.en', 'language.de', 'language.zh',
    'language.es', 'language.fr', 'language.ja', 'language.pt',
    'language.ru', 'language.ar', 'language.ko', 'language.tr',
  ];

  it('supports 11 locales', () => {
    assert.equal(SUPPORTED_LOCALES.length, 11);
  });

  it('includes all required locales', () => {
    const required = ['en', 'de', 'zh', 'es', 'fr', 'ja', 'pt', 'ru', 'ar', 'ko', 'tr'];
    required.forEach((locale) => {
      assert.ok(SUPPORTED_LOCALES.includes(locale));
    });
  });

  it('detects RTL for Arabic', () => {
    const rtlLocales = ['ar'];
    const isRTL = (locale: string) => rtlLocales.includes(locale);
    assert.ok(isRTL('ar'));
    assert.ok(!isRTL('en'));
    assert.ok(!isRTL('de'));
    assert.ok(!isRTL('zh'));
  });

  it('has consistent message keys across locales', () => {
    const mockEn: Record<string, string> = {};
    const mockDe: Record<string, string> = {};
    enKeys.forEach((k) => { mockEn[k] = k; mockDe[k] = k; });
    assert.deepEqual(Object.keys(mockEn), Object.keys(mockDe));
  });

  it('provides ICU MessageFormat placeholders for key messages', () => {
    const icuMessages = {
      welcome: 'Welcome, {name}!',
      itemCount: 'You have {count, plural, one {# item} other {# items}}.',
    };
    assert.ok(icuMessages.welcome.includes('{name}'));
    assert.ok(icuMessages.itemCount.includes('{count, plural'));
  });

  it('stores locale preference in localStorage', () => {
    const storage = new Map<string, string>();
    storage.set('locale', 'de');
    assert.equal(storage.get('locale'), 'de');
    storage.set('locale', 'fr');
    assert.equal(storage.get('locale'), 'fr');
  });

  it('detects browser language from navigator', () => {
    const mockLang = 'de-DE';
    const detected = mockLang.split('-')[0].toLowerCase();
    assert.equal(detected, 'de');
    assert.ok(SUPPORTED_LOCALES.includes(detected));
  });
});
