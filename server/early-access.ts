// Early access: gedeelde hulpfuncties voor de serverfuncties.
// De toegangscode komt uit de link (?toegang=...) en wordt door de browser meegestuurd als lijst `access`.

export const ACCESS_CODE = /^[a-z0-9-]{4,40}$/;

// Codes uit de aanvraag halen: alleen geldige, maximaal 5 (bijv. van meerdere drops)
export const accessCodes = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => ACCESS_CODE.test(x))
    .slice(0, 5);

export const dropLink = (origin: string, lang: 'nl' | 'en', slug: string, code: string) =>
  `${origin}${lang === 'en' ? '/en' : ''}/drops/${slug}/?toegang=${encodeURIComponent(code)}`;
