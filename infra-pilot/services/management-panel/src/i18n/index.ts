import { createContext, useContext } from 'react';
import type { SupportedLocale } from './locale-detector';

export interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  direction: 'ltr' | 'rtl';
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  direction: 'ltr',
});

export const useI18n = () => useContext(I18nContext);
