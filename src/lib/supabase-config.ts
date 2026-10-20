// Openbare Supabase-gegevens. Deze zijn bedoeld om in de browser te staan (publishable key);
// de beveiliging zit in de database (Row Level Security).
// Waarden komen uit de omgevingsvariabelen, niet uit de code:
//   PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY
// Zet hier NOOIT een secret key of service_role key.

export const SUPABASE_URL: string = (import.meta.env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_KEY: string = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const IMAGE_BUCKET = 'product-images';

export const publicImageUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`;
