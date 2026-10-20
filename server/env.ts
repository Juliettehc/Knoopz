// Instellingen voor de serverfuncties (Cloudflare Pages Functions).
// Geheimen staan ALLEEN in Cloudflare (Settings -> Variables and secrets, type "Secret"), nooit in de repo.
export interface Env {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string; // geheim: Supabase secret key (sb_secret_...)
  MOLLIE_API_KEY: string; // geheim: test_... om te testen, live_... bij de lancering
  RESEND_API_KEY?: string; // geheim: voor e-mails (optioneel tot het domein er is)
  MAIL_FROM?: string; // bijv. "KNOOPZ <bestellingen@knoopz.nl>"
  MAIL_REPLY_TO?: string; // bijv. "info@knoopz.nl"
  // Alleen voor lokale tests:
  MOLLIE_API_BASE?: string;
  RESEND_API_BASE?: string;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const thanksPath = (lang: string) => (lang === 'en' ? '/en/thank-you/' : '/bedankt/');
