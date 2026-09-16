import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { i18n, translate, type AppLanguage, type TranslationKey, type TranslationOptions } from './translations';
import { readLanguage, writeLanguage } from './languageStorage';

type LanguageContextValue = {
  language: AppLanguage;
  locale: 'vi-VN' | 'en-US';
  isRestoring: boolean;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('vi');
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let mounted = true;
    void readLanguage().then((storedLanguage) => {
      if (!mounted) return;
      const nextLanguage = storedLanguage ?? 'vi';
      i18n.locale = nextLanguage;
      setLanguageState(nextLanguage);
      setIsRestoring(false);
    }).catch(() => {
      if (!mounted) return;
      i18n.locale = 'vi';
      setLanguageState('vi');
      setIsRestoring(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setLanguage = useCallback(async (nextLanguage: AppLanguage) => {
    i18n.locale = nextLanguage;
    setLanguageState(nextLanguage);
    await writeLanguage(nextLanguage);
  }, []);

  const t = useCallback((key: TranslationKey, options?: TranslationOptions) => (
    translate(key, options)
  ), [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    locale: language === 'vi' ? 'vi-VN' : 'en-US',
    isRestoring,
    setLanguage,
    t,
  }), [isRestoring, language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
