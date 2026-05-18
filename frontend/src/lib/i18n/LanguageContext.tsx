"use client";

import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { en, Dictionary } from './dictionaries/en';
import { zh } from './dictionaries/zh';

export type Language = 'en' | 'zh';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  dict: Dictionary;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

type DictionaryValue = string | { [key: string]: DictionaryValue };

const languageSubscribers = new Set<() => void>();

const getBrowserLanguage = (): Language => {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const savedLang = localStorage.getItem('language');
  if (savedLang === 'en' || savedLang === 'zh') {
    return savedLang;
  }

  return 'en';
};

const subscribeToLanguage = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  languageSubscribers.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'language') {
      callback();
    }
  };

  window.addEventListener('storage', onStorage);
  return () => {
    languageSubscribers.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
};

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const language = useSyncExternalStore<Language>(subscribeToLanguage, getBrowserLanguage, () => 'en');

  const handleSetLanguage = (lang: Language) => {
    localStorage.setItem('language', lang);
    languageSubscribers.forEach(callback => callback());
  };

  const dict = language === 'en' ? en : zh;

  // Simple dot notation accessor (e.g., t('common.dashboard'))
  const t = (key: string): string => {
    const keys = key.split('.');
    let value: DictionaryValue | undefined = dict as DictionaryValue;
    for (const k of keys) {
      if (value === undefined || typeof value === 'string') return key;
      value = value[k];
    }
    return typeof value === 'string' ? value : key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t, dict }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
