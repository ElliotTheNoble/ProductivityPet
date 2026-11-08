import { useSyncExternalStore } from 'react';

import { careEn } from './care.en';
import { careEs } from './care.es';
import { familyEn } from './en';
import { familyEs } from './es';
import { historyEn } from './history.en';
import { historyEs } from './history.es';
import { homeEn } from './home.en';
import { homeEs } from './home.es';
import { listsEn } from './lists.en';
import { listsEs } from './lists.es';
import { roomsEn } from './rooms.en';
import { roomsEs } from './rooms.es';
import { namesEs } from './names.es';
import { familyManagementEn } from './family-management.en';
import { familyManagementEs } from './family-management.es';
import { profileChipEn } from './profile-chip.en';
import { profileChipEs } from './profile-chip.es';
import { idleEn } from './idle.en';
import { idleEs } from './idle.es';
import { tabLockEn } from './tab-lock.en';
import { tabLockEs } from './tab-lock.es';
import { notificationCleanupEn } from './notification-cleanup.en';
import { notificationCleanupEs } from './notification-cleanup.es';
import { familyPickerEn } from './family-picker.en';
import { familyPickerEs } from './family-picker.es';
import { parentClaimEn } from './parent-claim.en';
import { parentClaimEs } from './parent-claim.es';
import { parentGateEn } from './parent-gate.en';
import { parentPinEn } from './parent-pin.en';
import { parentGateEs } from './parent-gate.es';
import { parentPinEs } from './parent-pin.es';
import { pawadiseEn } from './pawadise.en';
import { pawadiseEs } from './pawadise.es';
import { shellEn } from './shell.en';
import { shopEn } from './shop.en';
import { statsEn } from './stats.en';
import { statsEs } from './stats.es';
import { shopEs } from './shop.es';
import { shellEs } from './shell.es';
import { tasksEn } from './tasks.en';
import { tasksEs } from './tasks.es';

// The app's one translation system. The catalog is split by area (family = onboarding + Parent Dashboard,
// shell = navigation / pet selector / shared dialogs; more areas are added batch by batch) and combined here.
// English is the base: a Spanish table that misses a key is a TypeScript error, and at run time a missing
// string falls back to English, never to a blank or a raw key.
//
// To add a language: create its tables (same keys), add them to TABLES, and add one line to LANGUAGES (its name
// in ITS OWN language). It then appears in every language picker.

export const en = { ...familyEn, ...shellEn, ...homeEn, ...tasksEn, ...roomsEn, ...shopEn, ...statsEn, ...historyEn, ...pawadiseEn, ...careEn, ...parentGateEn, ...parentPinEn, ...familyPickerEn, ...parentClaimEn, ...familyManagementEn, ...profileChipEn, ...idleEn, ...tabLockEn, ...notificationCleanupEn };
export type Strings = typeof en;
export type StringKey = keyof Strings;

export const es: Strings = { ...familyEs, ...shellEs, ...homeEs, ...tasksEs, ...roomsEs, ...shopEs, ...statsEs, ...historyEs, ...pawadiseEs, ...careEs, ...parentGateEs, ...parentPinEs, ...familyPickerEs, ...parentClaimEs, ...familyManagementEs, ...profileChipEs, ...idleEs, ...tabLockEs, ...notificationCleanupEs };

// Lists (message pools, month and weekday names). English is the fallback here too.
export type ListKey = keyof typeof listsEn;
const LIST_TABLES: Record<LanguageCode, Record<ListKey, string[]>> = { en: listsEn, es: listsEs };

export type LanguageCode = 'en' | 'es';

export const LANGUAGES: { code: LanguageCode; nativeName: string }[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
];

const TABLES: Record<LanguageCode, Strings> = { en, es };

// Date/number locale per language. English keeps `undefined` (the device's own formatting, exactly as the app did
// before translations existed); Spanish uses 'es'.
const LOCALES: Record<LanguageCode, string | undefined> = { en: undefined, es: 'es' };

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function isLanguageCode(v: unknown): v is LanguageCode {
  return v === 'en' || v === 'es';
}

export type Params = Record<string, string | number>;

// A message kept as a key (plus values) instead of finished text, so a temporary on-screen message follows a
// language change: store the Msg, show `t(msg.key, msg.params)`.
export type Msg = { key: StringKey; params?: Params };

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

// `{name}` placeholders are replaced from `params`.
export function translate(lang: LanguageCode, key: StringKey, params?: Params): string {
  return fill(TABLES[lang]?.[key] ?? en[key] ?? String(key), params);
}

// Plurals: define `<base>_one` and `<base>_other`; the count is also available as {count}.
export type PluralBase = StringKey extends infer K ? (K extends `${infer B}_one` ? B : never) : never;

export function translatePlural(lang: LanguageCode, base: PluralBase, count: number, params?: Params): string {
  const form = count === 1 ? 'one' : 'other';
  return translate(lang, `${base}_${form}` as StringKey, { count, ...params });
}

// A product's display name (Shop items, supplies, toys) in the language; the English name is also the stored
// identifier, so it is never changed. A name without a translation shows in English.
export function translateName(lang: LanguageCode, englishName: string): string {
  return lang === 'es' ? (namesEs[englishName] ?? englishName) : englishName;
}

export function trName(englishName: string): string {
  return translateName(current, englishName);
}

export function translateList(lang: LanguageCode, key: ListKey): string[] {
  const own = LIST_TABLES[lang]?.[key];
  return own && own.length > 0 ? own : listsEn[key];
}

// The current language lives in the onboarding store (so it is saved); this module only listens to it.
let current: LanguageCode = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();

export function setCurrentLanguage(lang: LanguageCode): void {
  if (lang === current) return;
  current = lang;
  listeners.forEach((l) => l());
}

// For non-React code that must redo work when the language changes (for example re-scheduling notifications).
export function subscribeToLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentLanguage(): LanguageCode {
  return current;
}

export function getLocale(lang: LanguageCode = current): string | undefined {
  return LOCALES[lang];
}

// For code that is not a React component (utilities, notifications): uses the current language.
export function tr(key: StringKey, params?: Params): string {
  return translate(current, key, params);
}

export function trList(key: ListKey): string[] {
  return translateList(current, key);
}

// Plural helper for non-component code.
export function tn(base: PluralBase, count: number, params?: Params): string {
  return translatePlural(current, base, count, params);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// In a component: `const { t, tn, lang } = useT();` then `t('save')`, `t('adoptLimit', { max: 3 })`. The component
// re-renders as soon as the language changes.
export function useT(): {
  t: (key: StringKey, params?: Params) => string;
  tn: (base: PluralBase, count: number, params?: Params) => string;
  tl: (key: ListKey) => string[];
  lang: LanguageCode;
  locale: string | undefined;
} {
  const lang = useSyncExternalStore(subscribe, getCurrentLanguage, () => DEFAULT_LANGUAGE);
  return {
    t: (key, params) => translate(lang, key, params),
    tn: (base, count, params) => translatePlural(lang, base, count, params),
    tl: (key) => translateList(lang, key),
    lang,
    locale: LOCALES[lang],
  };
}
