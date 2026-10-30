import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, DevSettings, I18nManager, Platform } from 'react-native';
import i18n, { setArabicDigits } from './i18n';

export type Lang = 'en' | 'ar';
export type Digits = 'latn' | 'arab';

export interface Prefs {
  lang: Lang;
  digits: Digits;
  tz: string;
  rtl: boolean;
  setPrefs(p: Partial<{ lang: Lang; digits: Digits; tz: string }>): void;
}

const deviceLang: Lang = getLocales()[0]?.languageCode === 'ar' ? 'ar' : 'en';
const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo';
const PrefsContext = createContext<Prefs>({ lang: 'en', digits: 'latn', tz: deviceTz, rtl: false, setPrefs: () => {} });

/**
 * Full RTL mirroring. Web: the `dir` attribute flips flexbox and logical (start/end) styles immediately.
 * Native: I18nManager.forceRTL only applies after a reload (B7 #5).
 */
export function applyDirection(lang: Lang) {
  const rtl = lang === 'ar';
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = lang;
    }
    return;
  }
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
    if (__DEV__) DevSettings.reload();
    else Alert.alert('', i18n.t('me.restart'));
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ lang: Lang; digits: Digits; tz: string }>({ lang: deviceLang, digits: 'latn', tz: deviceTz });

  useEffect(() => {
    AsyncStorage.getItem('circle-prefs')
      .then((raw) => {
        if (raw) setState((s) => ({ ...s, ...JSON.parse(raw) }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setArabicDigits(state.digits === 'arab');
    i18n.changeLanguage(state.lang);
    applyDirection(state.lang);
  }, [state.lang, state.digits]);

  const setPrefs = useCallback((p: Partial<{ lang: Lang; digits: Digits; tz: string }>) => {
    setState((s) => {
      const next = { ...s, ...p };
      AsyncStorage.setItem('circle-prefs', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ...state, rtl: state.lang === 'ar', setPrefs }), [state, setPrefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);

function locale(p: { lang: Lang; digits: Digits }) {
  return p.lang === 'ar' ? `ar-EG-u-nu-${p.digits}` : `en-GB-u-nu-${p.digits}`;
}

export function makeFormat(p: { lang: Lang; digits: Digits; tz: string }) {
  const loc = locale(p);
  const nf = new Intl.NumberFormat(loc);
  const df = (opts: Intl.DateTimeFormatOptions, tz?: string) => new Intl.DateTimeFormat(loc, { timeZone: tz ?? p.tz, ...opts });
  return {
    number: (n: number) => nf.format(n),
    money(minor: number, currency = 'EGP') {
      const major = minor / 100;
      try {
        return new Intl.NumberFormat(loc, { style: 'currency', currency, currencyDisplay: p.lang === 'ar' ? 'name' : 'code', minimumFractionDigits: major % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(major);
      } catch {
        return `${nf.format(major)} ${currency}`;
      }
    },
    date: (d: string | Date, tz?: string) => df({ weekday: 'short', day: 'numeric', month: 'short' }, tz).format(new Date(d)),
    time: (d: string | Date, tz?: string) => df({ hour: 'numeric', minute: '2-digit' }, tz).format(new Date(d)),
    dateTime: (d: string | Date, tz?: string) => df({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }, tz).format(new Date(d)),
    monthTitle: (d: Date, tz?: string) => df({ month: 'long', year: 'numeric' }, tz).format(d),
    dayNum: (d: Date, tz?: string) => df({ day: 'numeric' }, tz).format(d),
    weekdayShort: (d: Date, tz?: string) => df({ weekday: 'narrow' }, tz).format(d),
  };
}

export function useFormat() {
  const p = usePrefs();
  return useMemo(() => makeFormat(p), [p.lang, p.digits, p.tz]);
}
