// VOORBEELDDATA voor fase 3. In fase 4 komt dit uit Supabase.
// De velden volgen het datamodel uit het bouwplan (products, product_variants, drops),
// zodat de pagina's straks zonder ombouw op de database aansluiten.

export type Status = 'available' | 'sold';

export interface Drop {
  id: string;
  slug: string;
  name: { nl: string; en: string };
  intro: { nl: string; en: string };
}

export interface Product {
  id: string;
  code: string; // eigen productcode van KNOOPZ
  slug: string;
  dropId: string;
  category: 'pet' | 'overhemd';
  name: { nl: string; en: string };
  price: number | null; // in centen; null = nog niet ingevuld
  status: Status; // unieke pet: voorraad 1, dus beschikbaar of verkocht
  images: number; // aantal foto's (nu plaatshouders)
}

export const drops: Drop[] = [
  {
    id: 'drop-01',
    slug: 'drop-01',
    name: { nl: 'Drop 01', en: 'Drop 01' },
    intro: {
      nl: '[Korte tekst over deze drop: thema, aantal stuks, inspiratie.]',
      en: '[Short text about this drop: theme, number of pieces, inspiration.]',
    },
  },
];

const sold = new Set([3, 6]);

export const products: Product[] = Array.from({ length: 8 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    id: `pet-${n}`,
    code: '[code]',
    slug: `pet-${n}`,
    dropId: 'drop-01',
    category: 'pet' as const,
    name: { nl: `Pet ${n}`, en: `Cap ${n}` },
    price: null,
    status: sold.has(i + 1) ? ('sold' as const) : ('available' as const),
    images: 4,
  };
});

export const getDrop = (id: string) => drops.find((d) => d.id === id);
export const productsInDrop = (dropId: string) => products.filter((p) => p.dropId === dropId);
