import { useIntl } from 'react-intl';
import { useI18n } from './index';
import { SUPPORTED_LOCALES } from './locale-detector';

const localeNames: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
  ko: '한국어',
  tr: 'Türkçe',
};

export const LanguageSelector = () => {
  const intl = useIntl();
  const { locale, setLocale } = useI18n();
  const label = intl.formatMessage({ id: 'language.label' });

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="language-select" className="text-sm text-slate-400">
        {label}
      </label>
      <select
        id="language-select"
        value={locale}
        onChange={(e) => setLocale(e.target.value as any)}
        className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-blue-500"
        aria-label={label}
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code}>
            {localeNames[code]}
          </option>
        ))}
      </select>
    </div>
  );
};
