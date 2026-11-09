// Early access-codes uit de link (?toegang=...) onthouden in de browser,
// zodat de winkelwagen en het afrekenen ook op andere pagina's werken.
// De echte controle doet de server; deze code geeft op zich nergens recht op.

const KEY = 'knoopz-access';
const MAX_AGE = 60 * 24 * 60 * 60 * 1000; // 60 dagen

type Entry = { slug: string; code: string; saved: number };

const read = (): Entry[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.slug === 'string' && typeof e.code === 'string' && Date.now() - e.saved < MAX_AGE) : [];
  } catch {
    return [];
  }
};

const write = (list: Entry[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* opslag niet beschikbaar: de code werkt dan alleen op deze pagina */
  }
};

export const accessCodes = (): string[] => [...new Set(read().map((e) => e.code))];

export const codeFor = (slug: string): string | null => read().find((e) => e.slug === slug)?.code ?? null;

export const rememberAccess = (slug: string, code: string) =>
  write([...read().filter((e) => e.slug !== slug), { slug, code: code.trim().toLowerCase(), saved: Date.now() }]);

export const forgetAccess = (slug: string) => write(read().filter((e) => e.slug !== slug));

export type AccessItem = {
  id: string;
  slug: string;
  drop_slug: string;
  name_nl: string;
  name_en: string | null;
  price_cents: number | null;
  available: boolean;
  images: { small: string; large: string }[];
};

// Gegevens van producten in de winkelwagen die niet in de gebouwde site staan (early access, of net publiek)
export async function fetchAccessItems(ids: string[]): Promise<AccessItem[]> {
  const access = accessCodes();
  if (ids.length === 0) return [];
  try {
    const res = await fetch('/api/early-access-drop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: ids, access }),
    });
    if (!res.ok) return [];
    return (await res.json()).items ?? [];
  } catch {
    return [];
  }
}
