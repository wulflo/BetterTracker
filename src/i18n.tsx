import React, { createContext, useContext, useEffect, useState } from 'react';

export type Lang = 'es' | 'en';

const STORAGE_KEY = 'bt.lang';

const DICT: Record<Lang, Record<string, string>> = {
  es: {
    'app.subtitle': 'Entrena local, entiende tu cuerpo',
    'nav.panel': 'Alimentación',
    'nav.training': 'Entrenamiento',
    'nav.history': 'Historial',
    'nav.body': 'Figura corporal',
    'nav.wellness': 'Hábitos',
    'nav.mobile.panel': 'Comida',
    'nav.mobile.training': 'Entreno',
    'nav.mobile.history': 'Historial',
    'nav.mobile.body': 'Cuerpo',
    'nav.mobile.wellness': 'Hábitos',
    'settings': 'Ajustes y bóveda',
    'language': 'Idioma',
  },
  en: {
    'app.subtitle': 'Train locally, understand your body',
    'nav.panel': 'Nutrition',
    'nav.training': 'Training',
    'nav.history': 'History',
    'nav.body': 'Body',
    'nav.wellness': 'Habits',
    'nav.mobile.panel': 'Food',
    'nav.mobile.training': 'Train',
    'nav.mobile.history': 'History',
    'nav.mobile.body': 'Body',
    'nav.mobile.wellness': 'Habits',
    'settings': 'Settings and vault',
    'language': 'Language',
  },
};

export function t(key: string, lang: Lang): string {
  return DICT[lang]?.[key] ?? DICT.es[key] ?? key;
}

/**
 * Traducción en línea para textos de interfaz. Mantiene el español como
 * idioma de referencia y evita una clave intermedia para cada frase corta.
 */
export function tx(lang: Lang, es: string, en: string): string {
  return lang === 'en' ? en : es;
}

/** Locale usado por `toLocaleDateString` y `toLocaleString`. */
export function locale(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'es-ES';
}

/** Plural sencillo para contadores de interfaz. */
export function plural(_lang: Lang, n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Formatea un número con separadores del idioma activo. */
export function formatNumber(value: number, lang: Lang, decimals = 0): string {
  return value.toLocaleString(locale(lang), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface LanguageCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<LanguageCtx>({ lang: 'es', setLang: () => {} });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      // Por defecto, al instalar la app, está en inglés; se puede cambiar a español.
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'es' ? 'es' : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = (l: Lang) => setLangState(l);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLanguage(): LanguageCtx {
  return useContext(Ctx);
}
