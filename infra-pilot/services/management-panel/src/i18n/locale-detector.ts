const SUPPORTED_LOCALES = ['en', 'de', 'zh', 'es', 'fr', 'ja', 'pt', 'ru', 'ar', 'ko', 'tr'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export function detectBrowserLocale(): SupportedLocale {
  const stored = localStorage.getItem('locale') as SupportedLocale | null;
  if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;

  try {
    const raw = navigator.language || (navigator as any).userLanguage || 'en';
    const lang = raw.split('-')[0].toLowerCase();
    if (SUPPORTED_LOCALES.includes(lang as SupportedLocale)) return lang as SupportedLocale;
  } catch {}

  return 'en';
}

export function isRTL(locale: SupportedLocale): boolean {
  return locale === 'ar';
}

export { SUPPORTED_LOCALES };
