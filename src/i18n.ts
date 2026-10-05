import { useCallback, useState, useSyncExternalStore } from 'react';

export type Locale = 'en' | 'zh-CN';
export const LOCALE_STORAGE_KEY = 'workbench.locale';
const listeners = new Set<() => void>();
let selectedLocale: Locale | undefined;

export function resolveLocale(preference?: string | null, languages: readonly string[] = [], language?: string): Locale {
  if (preference === 'en' || preference === 'zh-CN') return preference;
  const browserLanguage = languages[0] || language;
  return browserLanguage?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function getLocale(): Locale {
  if (selectedLocale) return selectedLocale;
  let stored: string | null = null;
  try { stored = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null; } catch { /* Storage can be disabled. */ }
  return typeof navigator === 'undefined'
    ? resolveLocale(stored)
    : resolveLocale(stored, navigator.languages, navigator.language);
}

function notify() {
  if (typeof document !== 'undefined') document.documentElement.lang = getLocale();
  for (const listener of listeners) listener();
}

export function setLocale(locale: Locale) {
  selectedLocale = locale;
  try { globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Keep this session usable. */ }
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
      selectedLocale = undefined;
      notify();
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLocale(): readonly [Locale, typeof setLocale] {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return [locale, setLocale] as const;
}

/** Translate application-owned copy only. Researcher content remains verbatim. */
export function t(chinese: string, english: string): string {
  return getLocale() === 'zh-CN' ? chinese : english;
}

export type LocalizedCopy = string | (() => string);

/** Resolve only explicitly marked application copy; plain user/server text is verbatim. */
export function resolveCopy(value: LocalizedCopy): string {
  return typeof value === 'function' ? value() : value;
}

/** Keep already-visible application messages in sync with the selected language. */
export function useLocalizedMessage(initialValue: LocalizedCopy = ''): readonly [string, (value: LocalizedCopy) => void] {
  useLocale();
  const [value, storeValue] = useState<LocalizedCopy>(() => initialValue);
  const setValue = useCallback((next: LocalizedCopy) => { storeValue(() => next); }, []);
  return [resolveCopy(value), setValue] as const;
}
