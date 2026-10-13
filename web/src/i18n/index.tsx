import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { en, type Dict } from './en'

export type Lang = 'en' | 'tr'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
]

const STORAGE_KEY = 'observi-lang'

/** Keys callable via t(); `foo_one` / `foo_other` plural variants are addressed as `foo`. */
type PluralSuffix = '_one' | '_other'
export type Key = { [K in keyof Dict]: K extends `${infer B}${PluralSuffix}` ? B : K }[keyof Dict]
export type Params = Record<string, string | number>

type Dictionary = Record<string, string>

// ---- module-level state (so non-React code like lib/format and lib/api can translate) ----
let currentLang: Lang = 'en'
let currentDict: Dictionary = en
const dictCache: Partial<Record<Lang, Dictionary>> = { en }

export const getLang = () => currentLang
export const intlLocale = () => currentLang

function interpolate(s: string, params?: Params) {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m))
}

function lookup(dict: Dictionary, lang: Lang, key: string, params?: Params): string {
  let k = key
  if (params && typeof params.count === 'number') {
    const cat = new Intl.PluralRules(lang).select(params.count)
    if (`${key}_${cat}` in dict) k = `${key}_${cat}`
    else if (`${key}_other` in dict) k = `${key}_other`
  }
  return interpolate(dict[k] ?? (en as Dictionary)[k] ?? key, params)
}

/** Translate using the active language (usable outside React). */
export function translate(key: Key, params?: Params): string {
  return lookup(currentDict, currentLang, key, params)
}

/** Translate a dynamic key; returns undefined when the key does not exist. */
export function translateDynamic(key: string, params?: Params): string | undefined {
  if (!(key in currentDict) && !(key in en)) return undefined
  return lookup(currentDict, currentLang, key, params)
}

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'tr' || v === 'en') return v
  } catch {
    /* storage unavailable */
  }
  return 'en'
}

async function loadDict(lang: Lang): Promise<Dictionary> {
  const cached = dictCache[lang]
  if (cached) return cached
  const mod = await import('./tr')
  dictCache.tr = mod.tr
  return mod.tr
}

interface I18nValue {
  t: (key: Key, params?: Params) => string
  lang: Lang
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = readStoredLang()
    currentLang = l
    return l
  })
  const [dict, setDict] = useState<Dictionary>(en)

  // Keep module-level state in sync (set during render so children formatting is consistent).
  currentLang = lang
  currentDict = dict

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    let cancelled = false
    loadDict(lang)
      .then((d) => !cancelled && setDict(d))
      .catch(() => !cancelled && setDict(en)) // fall back to English if the chunk can't load
    return () => {
      cancelled = true
    }
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* storage unavailable */
    }
    setLangState(l)
  }, [])

  const value = useMemo<I18nValue>(
    () => ({ t: (key, params) => lookup(dict, lang, key, params), lang, setLang }),
    [dict, lang, setLang],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nValue {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useI18n must be used inside I18nProvider')
  return v
}

/** Splits `template` on `{placeholder}` markers and substitutes React nodes (e.g. <strong>). */
export function richText(template: string, values: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part)
    return m && m[1] in values ? <span key={i}>{values[m[1]]}</span> : part
  })
}
