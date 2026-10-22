// Productgegevens voor de website.
// Bij het bouwen van de site worden drops en producten uit Supabase gehaald.
// Of iets Sold out is, controleert de site daarnaast live in de browser (src/scripts/live.ts).

import { SUPABASE_URL, SUPABASE_KEY, publicImageUrl } from '../lib/supabase-config';

export type Status = 'available' | 'sold';
type T = { nl: string; en: string };

export interface ProductImage {
  small: string;
  large: string;
  alt: T;
}

export interface Drop {
  id: string;
  slug: string;
  name: T;
  intro: T;
}

export interface Product {
  id: string;
  code: string;
  slug: string;
  dropId: string | null;
  category: 'pet' | 'overhemd';
  name: T;
  description: T;
  details: T;
  buttonStory: T;
  price: number | null; // in centen; null = nog niet ingevuld
  status: Status;
  images: ProductImage[];
}

export interface SiteImage {
  url: string;
  alt: T;
  link: string | null;
}

export interface Catalog {
  drops: Drop[];
  products: Product[];
  site: Record<string, SiteImage>; // homepage-foto's: hero_desktop, hero_mobile, story, insta_1..6
  faq: { q: T; a: T }[];
  shipping: { nl: number | null; be: number | null; freeFrom: number | null };
  texts: Record<string, T>; // homepage-teksten: hero_title, story_title, story_text, insta_title
}

const t = (nl: string | null | undefined, en: string | null | undefined): T => ({ nl: nl ?? '', en: en || nl || '' });

async function rest<R>(path: string): Promise<R> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY } });
  if (!res.ok) throw new Error(`Supabase ${res.status} bij ${path}: ${await res.text()}`);
  return res.json() as Promise<R>;
}

async function fromSupabase(): Promise<Catalog> {
  const [dropRows, productRows, siteRows, textRows, faqRows, settingRows] = await Promise.all([
    rest<any[]>('drops?select=*&published=eq.true&order=sort.asc,created_at.asc'),
    rest<any[]>(
      'products?select=*,product_variants(status,stock),product_images(path_small,path_large,alt_nl,alt_en,sort)&published=eq.true&order=sort.asc,created_at.asc',
    ),
    // Homepage-foto's zijn optioneel: als de tabel (nog) niet bestaat, bouwt de site gewoon met plaatshouders.
    rest<any[]>('site_images?select=*').catch(() => [] as any[]),
    rest<any[]>('site_texts?select=*').catch(() => [] as any[]),
    rest<any[]>('faq_items?select=*&published=eq.true&order=sort.asc,created_at.asc').catch(() => [] as any[]),
    rest<any[]>('settings?select=*').catch(() => [] as any[]),
  ]);
  const st: any = (Array.isArray(settingRows) ? settingRows[0] : settingRows) ?? {};
  const shipping = { nl: st.shipping_cents ?? null, be: st.shipping_be_cents ?? st.shipping_cents ?? null, freeFrom: st.free_shipping_from_cents ?? null };
  const faq = faqRows.map((r) => ({ q: t(r.question_nl, r.question_en), a: t(r.answer_nl, r.answer_en) }));
  const texts: Record<string, T> = Object.fromEntries(textRows.filter((r) => r.nl).map((r) => [r.key, t(r.nl, r.en)]));
  const site: Record<string, SiteImage> = Object.fromEntries(
    siteRows.map((r) => [r.key, { url: publicImageUrl(r.path), alt: t(r.alt_nl, r.alt_en), link: r.link || null }]),
  );
  const drops: Drop[] = dropRows.map((d) => ({ id: d.id, slug: d.slug, name: t(d.name_nl, d.name_en), intro: t(d.intro_nl, d.intro_en) }));
  const products: Product[] = productRows.map((p) => {
    const variants: { status: string; stock: number }[] = p.product_variants ?? [];
    const available = variants.some((v) => v.status !== 'sold' && v.stock > 0);
    const images = [...(p.product_images ?? [])]
      .sort((a, b) => a.sort - b.sort)
      .map((i) => ({ small: publicImageUrl(i.path_small), large: publicImageUrl(i.path_large), alt: t(i.alt_nl || p.name_nl, i.alt_en || p.name_en) }));
    return {
      id: p.id,
      code: p.code,
      slug: p.slug,
      dropId: p.drop_id,
      category: p.category,
      name: t(p.name_nl, p.name_en),
      description: t(p.description_nl, p.description_en),
      details: t(p.details_nl, p.details_en),
      buttonStory: t(p.button_story_nl, p.button_story_en),
      price: p.price_cents,
      status: available ? 'available' : 'sold',
      images,
    };
  });
  return { drops, products, site, texts, faq, shipping };
}

// Voorbeelddata, alleen voor lokaal ontwikkelen zonder database (KNOOPZ_SAMPLE_DATA=1).
function sample(): Catalog {
  const drop: Drop = {
    id: 'sample-drop',
    slug: 'drop-01',
    name: { nl: 'Drop 01', en: 'Drop 01' },
    intro: { nl: '[Korte tekst over deze drop]', en: '[Short text about this drop]' },
  };
  const sold = new Set([3, 6]);
  const products: Product[] = Array.from({ length: 8 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `sample-${n}`,
      code: `VB-${n}`,
      slug: `pet-${n}`,
      dropId: drop.id,
      category: 'pet',
      name: { nl: `Pet ${n}`, en: `Cap ${n}` },
      description: { nl: '', en: '' },
      details: { nl: '', en: '' },
      buttonStory: { nl: '', en: '' },
      price: null,
      status: sold.has(i + 1) ? 'sold' : 'available',
      images: [],
    };
  });
  return { drops: [drop], products, site: {}, texts: {}, faq: [], shipping: { nl: 495, be: 795, freeFrom: null } };
}

let cache: Promise<Catalog> | undefined;

export function loadCatalog(): Promise<Catalog> {
  if (!cache) {
    const sampleMode = (globalThis as any).process?.env?.KNOOPZ_SAMPLE_DATA ?? import.meta.env.KNOOPZ_SAMPLE_DATA;
    if (sampleMode === '1') {
      cache = Promise.resolve(sample());
    } else if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error(
        'PUBLIC_SUPABASE_URL of PUBLIC_SUPABASE_PUBLISHABLE_KEY ontbreekt. Stel ze in bij Cloudflare (Variables) of in .env. Gebruik KNOOPZ_SAMPLE_DATA=1 voor voorbeelddata.',
      );
    } else {
      cache = fromSupabase();
    }
  }
  return cache;
}

export const productsInDrop = (c: Catalog, dropId: string) => c.products.filter((p) => p.dropId === dropId);
export const getDrop = (c: Catalog, id: string | null) => c.drops.find((d) => d.id === id);
