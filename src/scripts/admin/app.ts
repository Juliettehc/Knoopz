// KNOOPZ beheer: inloggen, producten, foto's, drops, bestellingen, kortingscodes, instellingen en publiceren.
// Werkt rechtstreeks met Supabase. Wat wel en niet mag, bepaalt de database (Row Level Security).

import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, IMAGE_BUCKET, publicImageUrl } from '../../lib/supabase-config';
import { resizeImage } from './images';
import { renderEmail, TEMPLATES, DEFAULTS, FIELD_LABELS, PLACEHOLDERS, SAMPLE_ORDER } from '../../lib/email-templates.js';

// Uitleg over tekstopmaak, overal hetzelfde (zie textBlocks in lib/rich.ts)
const FORMAT_HELP = 'Opmaak in lange teksten: <strong>**woord**</strong> = dikgedrukt, een regel met <strong>## </strong> = tussenkop, <strong>- </strong> = opsomming met knoopjes, <strong>1. </strong> = genummerde lijst, witregel = nieuwe alinea.';

// Uitnodigings- of herstellink? Dit moet gelezen worden vóórdat Supabase de link verwerkt.
const linkParams = new URLSearchParams(location.hash.startsWith('#/') ? '' : location.hash.slice(1));
let pendingPasswordSetup = ['invite', 'recovery', 'signup'].includes(linkParams.get('type') || '');

const app = document.getElementById('app')!;
const topbar = document.querySelector<HTMLElement>('[data-topbar]')!;
const toastEl = document.querySelector<HTMLElement>('[data-toast]')!;
const dirtyEl = document.querySelector<HTMLElement>('[data-dirty]')!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  app.innerHTML = '<p class="a-error">De Supabase-instellingen ontbreken in deze versie van de site (PUBLIC_SUPABASE_URL en PUBLIC_SUPABASE_PUBLISHABLE_KEY).</p>';
  throw new Error('Supabase-config ontbreekt');
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

// ---------- hulpfuncties ----------
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let toastTimer: number | undefined;
function toast(msg: string, error = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', error);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), error ? 7000 : 3500);
}

function fail(e: unknown, what: string) {
  console.error(e);
  const msg = (e as any)?.message || String(e);
  toast(`${what} is niet gelukt: ${msg}`, true);
}

const DIRTY_KEY = 'knoopz-admin-dirty';
function setDirty(v: boolean) {
  try {
    v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY);
  } catch {}
  dirtyEl.hidden = !v;
}
function isDirty() {
  try {
    return localStorage.getItem(DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

const euro = (cents: number | null) => (cents === null || cents === undefined ? '—' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100));
function parseEuro(v: string): number | null {
  const s = v.trim().replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!s) return null;
  const n = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${v}" is geen geldig bedrag`);
  return n;
}
const centsToInput = (c: number | null) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const val = (form: HTMLFormElement, name: string) => ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '').trim();
const checked = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;
const orNull = (s: string) => (s ? s : null);

// ---------- sessie en toegang ----------
let session: Session | null = null;
let adminOk = false;

async function checkAdmin(): Promise<boolean> {
  const { data, error } = await sb.rpc('is_admin');
  if (error) throw error;
  return data === true;
}

sb.auth.onAuthStateChange((event, s) => {
  session = s;
  if (event === 'PASSWORD_RECOVERY') pendingPasswordSetup = true;
});

// ---------- router ----------
async function route() {
  const { data } = await sb.auth.getSession();
  session = data.session;

  if (!session) {
    topbar.hidden = true;
    dirtyEl.hidden = true;
    return viewLogin();
  }
  if (pendingPasswordSetup) {
    topbar.hidden = true;
    return viewSetPassword();
  }
  if (!adminOk) {
    try {
      adminOk = await checkAdmin();
    } catch (e) {
      return fail(e, 'Toegang controleren');
    }
    if (!adminOk) {
      topbar.hidden = true;
      app.innerHTML = `<div class="a-card a-login"><h1>Geen toegang</h1><p>Het account ${esc(session.user.email)} is (nog) geen beheerder van KNOOPZ.</p><div class="a-buttons"><button class="btn btn-dark" data-out>Uitloggen</button></div></div>`;
      app.querySelector('[data-out]')!.addEventListener('click', logout);
      return;
    }
  }

  topbar.hidden = false;
  dirtyEl.hidden = !isDirty();
  document.querySelector('[data-user]')!.textContent = session.user.email ?? '';

  const [, section, id] = (location.hash || '#/producten').split('/');
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    a.toggleAttribute('aria-current', false);
    if (a.dataset.nav === (section === 'product' ? 'producten' : section === 'bestelling' ? 'bestellingen' : section || 'producten'))
      document.querySelector('[data-current]')!.textContent = a.textContent;
    const navKey = section === 'product' ? 'producten' : section === 'bestelling' ? 'bestellingen' : section;
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
  });

  if (section === 'product') return viewProduct(id === 'nieuw' ? null : id);
  if (section === 'drops') return viewDrops();
  if (section === 'overzicht') return viewStats();
  if (section === 'bestellingen') return viewOrders();
  if (section === 'bestelling' && id) return viewOrder(id);
  if (section === 'kortingscodes') return viewCodes();
  if (section === 'homepage') return viewSitePage(HOME_CFG);
  if (section === 'over') return viewSitePage(ABOUT_CFG);
  if (section === 'contact') return viewSitePage(CONTACT_CFG);
  if (section === 'faq') return viewFaq();
  if (section === 'verzending') return viewSitePage(SHIP_CFG);
  if (section === 'privacy') return viewSitePage(PRIVACY_CFG);
  if (section === 'voorwaarden') return viewSitePage(TERMS_CFG);
  if (section === 'instellingen') return viewSettings();
  if (section === 'emails') return viewEmails();
  return viewProducts();
}

window.addEventListener('hashchange', () => {
  setMenu(false);
  route();
});

// ---------- uitklapmenu ----------
const menuEl = document.querySelector<HTMLElement>('[data-menu]')!;
const menuBackdrop = document.querySelector<HTMLElement>('[data-menu-backdrop]')!;
const menuBtn = document.querySelector<HTMLButtonElement>('[data-menu-open]')!;
function setMenu(open: boolean) {
  menuEl.hidden = !open;
  menuBackdrop.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) menuEl.querySelector<HTMLElement>('[aria-current="page"], [data-nav]')?.focus();
}
menuBtn.addEventListener('click', () => setMenu(true));
document.querySelector('[data-menu-close]')!.addEventListener('click', () => {
  setMenu(false);
  menuBtn.focus();
});
menuBackdrop.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menuEl.hidden) {
    setMenu(false);
    menuBtn.focus();
  }
});
menuEl.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', () => setMenu(false)));

async function logout() {
  await sb.auth.signOut();
  adminOk = false;
  location.hash = '';
  route();
}
document.querySelector('[data-logout]')!.addEventListener('click', logout);

// ---------- publiceren ----------
document.querySelector('[data-publish]')!.addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  const { error } = await sb.from('publish_requests').insert({});
  btn.disabled = false;
  if (error) return fail(error, 'Publiceren');
  setDirty(false);
  toast('Publicatie gestart. De website is over 1 à 2 minuten bijgewerkt.');
});

// ---------- inloggen ----------
function viewLogin() {
  app.innerHTML = `
    <div class="a-card a-login">
      <img src="/knoopz-logo.png" alt="KNOOPZ" width="900" height="169" />
      <h1>Inloggen</h1>
      <form class="a-form" data-login novalidate>
        <label class="a-field"><span>E-mailadres</span><input name="email" type="email" autocomplete="username" required /></label>
        <label class="a-field"><span>Wachtwoord</span><input name="password" type="password" autocomplete="current-password" required /></label>
        <p class="a-error" data-err hidden></p>
        <div class="a-buttons">
          <button class="btn btn-dark" type="submit">Inloggen</button>
          <button class="a-link" type="button" data-forgot>Wachtwoord vergeten?</button>
        </div>
      </form>
    </div>`;
  const form = app.querySelector<HTMLFormElement>('[data-login]')!;
  const err = app.querySelector<HTMLElement>('[data-err]')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: val(form, 'email'), password: (form.elements.namedItem('password') as HTMLInputElement).value });
    if (error) {
      err.textContent = 'Inloggen mislukt. Controleer je e-mailadres en wachtwoord.';
      err.hidden = false;
      return;
    }
    location.hash = '#/producten';
    route();
  });
  app.querySelector('[data-forgot]')!.addEventListener('click', async () => {
    const email = val(form, 'email');
    if (!email) {
      err.textContent = 'Vul eerst je e-mailadres in.';
      err.hidden = false;
      return;
    }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/` });
    if (error) return fail(error, 'Herstelmail versturen');
    toast('Als dit e-mailadres bekend is, staat er een mail klaar om je wachtwoord in te stellen.');
  });
}

// ---------- wachtwoord instellen (na uitnodiging of herstel) ----------
function viewSetPassword() {
  app.innerHTML = `
    <div class="a-card a-login">
      <img src="/knoopz-logo.png" alt="KNOOPZ" width="900" height="169" />
      <h1>Kies je wachtwoord</h1>
      <p class="a-note">Voor ${esc(session?.user.email)}. Minimaal 12 tekens.</p>
      <form class="a-form" data-pw novalidate>
        <label class="a-field"><span>Nieuw wachtwoord</span><input name="pw" type="password" autocomplete="new-password" minlength="12" required /></label>
        <label class="a-field"><span>Herhaal wachtwoord</span><input name="pw2" type="password" autocomplete="new-password" minlength="12" required /></label>
        <p class="a-error" data-err hidden></p>
        <div class="a-buttons"><button class="btn btn-dark" type="submit">Opslaan</button></div>
      </form>
    </div>`;
  bindPasswordForm(app.querySelector<HTMLFormElement>('[data-pw]')!, () => {
    pendingPasswordSetup = false;
    history.replaceState(null, '', '/admin/#/producten');
    route();
  });
}

function bindPasswordForm(form: HTMLFormElement, done: () => void) {
  const err = form.querySelector<HTMLElement>('[data-err]')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = (form.elements.namedItem('pw') as HTMLInputElement).value;
    const pw2 = (form.elements.namedItem('pw2') as HTMLInputElement).value;
    err.hidden = true;
    if (pw.length < 12) {
      err.textContent = 'Gebruik minimaal 12 tekens.';
      err.hidden = false;
      return;
    }
    if (pw !== pw2) {
      err.textContent = 'De twee wachtwoorden zijn niet gelijk.';
      err.hidden = false;
      return;
    }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) {
      err.textContent = `Opslaan mislukt: ${error.message}`;
      err.hidden = false;
      return;
    }
    toast('Wachtwoord opgeslagen.');
    form.reset();
    done();
  });
}

// ---------- producten: overzicht ----------
type Drop = { id: string; slug: string; name_nl: string; name_en: string | null; intro_nl: string | null; intro_en: string | null; sort: number; published: boolean; image_path?: string | null };

async function loadDrops(): Promise<Drop[]> {
  const { data, error } = await sb.from('drops').select('*').order('sort').order('created_at');
  if (error) throw error;
  return data as Drop[];
}

async function viewProducts() {
  app.innerHTML = '<p class="muted">Producten laden…</p>';
  const [{ data, error }, drops] = await Promise.all([
    sb.from('products').select('id,code,name_nl,price_cents,published,sort,drop_id,product_variants(status,stock),product_images(path_small,sort)').order('sort').order('created_at'),
    loadDrops().catch(() => [] as Drop[]),
  ]);
  if (error) return fail(error, 'Producten laden');
  const dropName = new Map(drops.map((d) => [d.id, d.name_nl]));
  const rows = (data as any[]).map((p) => {
    const sold = !(p.product_variants ?? []).some((v: any) => v.status !== 'sold' && v.stock > 0);
    const img = [...(p.product_images ?? [])].sort((a: any, b: any) => a.sort - b.sort)[0];
    return { ...p, sold, img: img ? publicImageUrl(img.path_small) : null, drop: dropName.get(p.drop_id) ?? '—' };
  });

  app.innerHTML = `
    <h1>Producten</h1>
    <div class="a-toolbar">
      <input class="a-search" type="search" placeholder="Zoek op naam of code" aria-label="Zoek producten" data-q />
      <div class="a-filters" role="group" aria-label="Filter">
        <button class="filter" aria-pressed="true" data-f="all">Alle</button>
        <button class="filter" aria-pressed="false" data-f="available">Beschikbaar</button>
        <button class="filter" aria-pressed="false" data-f="sold">Verkocht</button>
        <button class="filter" aria-pressed="false" data-f="hidden">Verborgen</button>
      </div>
      <a class="btn btn-dark" href="#/product/nieuw">Nieuw product</a>
    </div>
    <p class="a-note" data-count></p>
    <div class="a-scroll">
      <table class="a-table">
        <thead><tr><th class="hide-xs">Foto</th><th>Code</th><th>Naam</th><th class="hide-sm">Drop</th><th>Prijs</th><th>Status</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>`;

  const tbody = app.querySelector<HTMLElement>('[data-rows]')!;
  const q = app.querySelector<HTMLInputElement>('[data-q]')!;
  const count = app.querySelector<HTMLElement>('[data-count]')!;
  let filter = 'all';
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (term && !`${r.name_nl} ${r.code}`.toLowerCase().includes(term)) return false;
      if (filter === 'available') return !r.sold && r.published;
      if (filter === 'sold') return r.sold;
      if (filter === 'hidden') return !r.published;
      return true;
    });
    count.textContent = `${list.length} van ${rows.length} producten`;
    tbody.innerHTML = list.length
      ? list
          .map(
            (r) => `<tr>
          <td class="hide-xs">${r.img ? `<img class="a-thumb" src="${esc(r.img)}" alt="" loading="lazy" />` : '<span class="a-thumb"></span>'}</td>
          <td>${esc(r.code)}</td>
          <td><a href="#/product/${esc(r.id)}">${esc(r.name_nl)}</a></td>
          <td class="hide-sm">${esc(r.drop)}</td>
          <td>${esc(euro(r.price_cents))}</td>
          <td>${r.sold ? '<span class="a-pill sold">Verkocht</span>' : '<span class="a-pill">Beschikbaar</span>'} ${r.published ? '' : '<span class="a-pill hidden">Verborgen</span>'}</td>
        </tr>`,
          )
          .join('')
      : '<tr><td colspan="6" class="muted">Geen producten gevonden.</td></tr>';
  };
  q.addEventListener('input', render);
  app.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f!;
      app.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    }),
  );
  render();
}

// ---------- product: bewerken ----------
// Verzendsoort: eigen keuze bij het product, anders volgens de categorie (overhemd = brievenbuspakje)
const parcelOf = (p: any): 'package' | 'mailbox' => p?.parcel_type ?? (p?.category === 'overhemd' ? 'mailbox' : 'package');

async function viewProduct(id: string | null) {
  app.innerHTML = '<p class="muted">Laden…</p>';
  let drops: Drop[] = [];
  let p: any = null;
  try {
    drops = await loadDrops();
    if (id) {
      const { data, error } = await sb.from('products').select('*,product_variants(*)').eq('id', id).single();
      if (error) throw error;
      p = data;
    }
  } catch (e) {
    return fail(e, 'Product laden');
  }
  const variant = p?.product_variants?.[0];
  const sold = variant ? variant.status === 'sold' || variant.stock === 0 : false;
  const isNew = !p;

  const text = (name: string, label: string, opts: { req?: boolean; hint?: string } = {}) =>
    `<label class="a-field"><span>${label}${opts.req ? ' *' : ''}</span><input name="${name}" value="${esc(p?.[name])}" ${opts.req ? 'required' : ''} />${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
  const area = (name: string, label: string) => `<label class="a-field"><span>${label}</span><textarea name="${name}">${esc(p?.[name])}</textarea><small>${FORMAT_HELP}</small></label>`;

  app.innerHTML = `
    <p><a href="#/producten">← Terug naar producten</a></p>
    <h1>${isNew ? 'Nieuw product' : esc(p.name_nl)}</h1>
    <form class="a-form a-card" data-product novalidate>
      <div class="a-row a-row-3">
        ${text('code', 'Productcode', { req: true, hint: 'Jullie eigen code, bijvoorbeeld KNZ-001' })}
        <label class="a-field"><span>Drop</span><select name="drop_id"><option value="">Geen drop</option>${drops
          .map((d) => `<option value="${esc(d.id)}" ${p?.drop_id === d.id ? 'selected' : ''}>${esc(d.name_nl)}</option>`)
          .join('')}</select></label>
        <label class="a-field"><span>Categorie</span><select name="category">
          <option value="pet" ${p?.category !== 'overhemd' ? 'selected' : ''}>Pet</option>
          <option value="overhemd" ${p?.category === 'overhemd' ? 'selected' : ''}>Overhemd</option></select></label>
      </div>
      <div class="a-row">
        <label class="a-field"><span>Verzending (PostNL)</span><select name="parcel_type">
          <option value="package" ${parcelOf(p) === 'package' ? 'selected' : ''}>Pakket</option>
          <option value="mailbox" ${parcelOf(p) === 'mailbox' ? 'selected' : ''}>Brievenbuspakje</option></select>
          <small>Petten standaard als pakket, overhemden als brievenbuspakje. Zitten er meerdere stukken in één bestelling, dan wordt het een pakket zodra er één pakket bij zit.</small></label>
      </div>
      <div class="a-row">
        ${text('name_nl', 'Naam (NL)', { req: true })}
        ${text('name_en', 'Naam (EN)', { hint: 'Leeg = Nederlandse naam' })}
      </div>
      <div class="a-row">
        <label class="a-field"><span>Prijs (€)</span><input name="price" inputmode="decimal" placeholder="bijv. 45,00" value="${esc(centsToInput(p?.price_cents))}" /></label>
        <label class="a-field"><span>Status</span><select name="status">
          <option value="available" ${!sold ? 'selected' : ''}>Beschikbaar</option>
          <option value="sold" ${sold ? 'selected' : ''}>Verkocht (Sold out)</option></select></label>
      </div>
      <div class="a-row">
        ${area('description_nl', 'Korte beschrijving (NL)')}
        ${area('description_en', 'Korte beschrijving (EN)')}
      </div>
      <div class="a-row">
        ${area('details_nl', 'Details: materiaal, pasvorm, verzorging (NL)')}
        ${area('details_en', 'Details (EN)')}
      </div>
      <div class="a-row">
        ${area('button_story_nl', 'Over deze knoop (NL)')}
        ${area('button_story_en', 'Over deze knoop (EN)')}
      </div>
      <div class="a-row">
        ${text('slug', 'Webadres', { hint: 'Wordt automatisch gemaakt, bijv. knz-001-pet-rood' })}
        <label class="a-field"><span>Volgorde</span><input name="sort" type="number" value="${esc(p?.sort ?? 0)}" /><small>Lager getal = eerder in de shop</small></label>
      </div>
      <label class="a-check"><input type="checkbox" name="published" ${p?.published ? 'checked' : ''} /> Zichtbaar in de shop</label>
      <p class="a-error" data-err hidden></p>
      <div class="a-buttons">
        <button class="btn btn-dark" type="submit">${isNew ? 'Product aanmaken' : 'Opslaan'}</button>
        ${isNew ? '' : '<button class="btn btn-danger" type="button" data-delete>Product verwijderen</button>'}
      </div>
    </form>
    <h2>Foto's</h2>
    <div data-photos></div>`;

  const form = app.querySelector<HTMLFormElement>('[data-product]')!;
  const err = form.querySelector<HTMLElement>('[data-err]')!;
  // Nieuw product: verzendsoort volgt de categorie (kan daarna nog worden aangepast)
  if (!p) {
    const cat = form.elements.namedItem('category') as HTMLSelectElement;
    const parcel = form.elements.namedItem('parcel_type') as HTMLSelectElement;
    cat.addEventListener('change', () => (parcel.value = cat.value === 'overhemd' ? 'mailbox' : 'package'));
  }
  const slugInput = form.elements.namedItem('slug') as HTMLInputElement;
  let slugTouched = !!p?.slug;
  slugInput.addEventListener('input', () => (slugTouched = true));
  const autoSlug = () => {
    if (!slugTouched) slugInput.value = slugify(`${val(form, 'code')} ${val(form, 'name_nl')}`);
  };
  (form.elements.namedItem('code') as HTMLInputElement).addEventListener('input', autoSlug);
  (form.elements.namedItem('name_nl') as HTMLInputElement).addEventListener('input', autoSlug);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const code = val(form, 'code');
      const name = val(form, 'name_nl');
      if (!code || !name) throw new Error('Productcode en naam (NL) zijn verplicht.');
      const slug = slugify(val(form, 'slug') || `${code} ${name}`);
      if (!slug) throw new Error('Het webadres is leeg.');
      const row = {
        code,
        slug,
        drop_id: orNull(val(form, 'drop_id')),
        category: val(form, 'category') || 'pet',
        parcel_type: val(form, 'parcel_type') === 'mailbox' ? 'mailbox' : 'package',
        name_nl: name,
        name_en: orNull(val(form, 'name_en')),
        description_nl: orNull(val(form, 'description_nl')),
        description_en: orNull(val(form, 'description_en')),
        details_nl: orNull(val(form, 'details_nl')),
        details_en: orNull(val(form, 'details_en')),
        button_story_nl: orNull(val(form, 'button_story_nl')),
        button_story_en: orNull(val(form, 'button_story_en')),
        price_cents: parseEuro(val(form, 'price')),
        published: checked(form, 'published'),
        sort: parseInt(val(form, 'sort') || '0', 10) || 0,
      };
      const productId = p?.id ?? crypto.randomUUID();
      const save = (r: Record<string, unknown>) =>
        isNew ? sb.from('products').insert({ id: productId, ...r }) : sb.from('products').update(r).eq('id', productId);
      let { error } = await save(row);
      // Migratie 012 (verzendsoort) nog niet uitgevoerd? Dan zonder dat veld opslaan.
      if (error && /parcel_type/.test(error.message)) {
        const { parcel_type, ...rest } = row;
        ({ error } = await save(rest));
      }
      if (error) throw error;
      const isSold = val(form, 'status') === 'sold';
      const { error: vErr } = await sb
        .from('product_variants')
        .upsert({ product_id: productId, size: 'one-size', stock: isSold ? 0 : 1, status: isSold ? 'sold' : 'available' }, { onConflict: 'product_id,size' });
      if (vErr) throw vErr;
      setDirty(true);
      toast(isNew ? 'Product aangemaakt. Je kunt nu foto\'s toevoegen.' : 'Opgeslagen.');
      if (isNew) location.hash = `#/product/${productId}`;
      else viewProduct(productId);
    } catch (e: any) {
      const msg = e?.code === '23505' ? 'Deze productcode of dit webadres bestaat al.' : e?.message || String(e);
      err.textContent = `Opslaan mislukt: ${msg}`;
      err.hidden = false;
    }
  });

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!confirm(`Weet je zeker dat je "${p.name_nl}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
    try {
      const { data: imgs } = await sb.from('product_images').select('path_small,path_large').eq('product_id', p.id);
      const paths = (imgs ?? []).flatMap((i: any) => [i.path_small, i.path_large]);
      if (paths.length) await sb.storage.from(IMAGE_BUCKET).remove(paths);
      const { error } = await sb.from('products').delete().eq('id', p.id);
      if (error) throw error;
      setDirty(true);
      toast('Product verwijderd.');
      location.hash = '#/producten';
    } catch (e) {
      fail(e, 'Verwijderen');
    }
  });

  renderPhotos(app.querySelector<HTMLElement>('[data-photos]')!, p?.id ?? null, p?.name_nl ?? '');
}

// ---------- foto's ----------
async function renderPhotos(box: HTMLElement, productId: string | null, productName: string) {
  if (!productId) {
    box.innerHTML = '<p class="a-note">Maak het product eerst aan; daarna kun je foto\'s toevoegen.</p>';
    return;
  }
  const { data, error } = await sb.from('product_images').select('*').eq('product_id', productId).order('sort');
  if (error) return fail(error, 'Foto\'s laden');
  const imgs = data as any[];

  box.innerHTML = `
    <div class="a-drop" data-drop>
      Sleep foto's hierheen of <label class="a-link" style="cursor:pointer">kies bestanden<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-file /></label>
      <p class="a-note">Formaat 2000 × 2500 px (4:5). De eerste foto is de hoofdfoto, de tweede verschijnt bij hover in de shop.</p>
    </div>
    <div class="a-images">
      ${imgs
        .map(
          (im, i) => `
        <div class="a-image" data-id="${esc(im.id)}">
          <img src="${esc(publicImageUrl(im.path_small))}" alt="" />
          <div class="a-row">
            <label class="a-field"><span>Beschrijving (NL)</span><input data-alt="alt_nl" value="${esc(im.alt_nl)}" placeholder="bijv. ${esc(productName)}, vooraanzicht" /></label>
            <label class="a-field"><span>Beschrijving (EN)</span><input data-alt="alt_en" value="${esc(im.alt_en)}" /></label>
          </div>
          <div class="a-image-actions">
            <button type="button" class="a-icon" data-move="-1" aria-label="Foto naar voren" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="a-icon" data-move="1" aria-label="Foto naar achteren" ${i === imgs.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="a-icon" data-remove aria-label="Foto verwijderen">✕</button>
          </div>
        </div>`,
        )
        .join('')}
    </div>
    <p class="a-note" data-progress></p>`;

  const progress = box.querySelector<HTMLElement>('[data-progress]')!;
  const upload = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    let sort = imgs.reduce((m, i) => Math.max(m, i.sort), -1) + 1;
    for (let n = 0; n < list.length; n++) {
      const f = list[n];
      progress.textContent = `Bezig met uploaden: foto ${n + 1} van ${list.length}…`;
      try {
        const [small, large] = await Promise.all([resizeImage(f, 800), resizeImage(f, 2000)]);
        const base = `products/${productId}/${crypto.randomUUID()}`;
        const pathSmall = `${base}-800.jpg`;
        const pathLarge = `${base}-2000.jpg`;
        const s1 = await sb.storage.from(IMAGE_BUCKET).upload(pathSmall, small, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (s1.error) throw s1.error;
        const s2 = await sb.storage.from(IMAGE_BUCKET).upload(pathLarge, large, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (s2.error) throw s2.error;
        const { error } = await sb.from('product_images').insert({ product_id: productId, path_small: pathSmall, path_large: pathLarge, sort: sort++ });
        if (error) throw error;
      } catch (e) {
        fail(e, `Uploaden van ${f.name}`);
      }
    }
    progress.textContent = '';
    setDirty(true);
    renderPhotos(box, productId, productName);
  };

  box.querySelector<HTMLInputElement>('[data-file]')!.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files?.length) upload(files);
  });
  const drop = box.querySelector<HTMLElement>('[data-drop]')!;
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files.length) upload(e.dataTransfer.files);
  });

  box.querySelectorAll<HTMLElement>('.a-image').forEach((row, i) => {
    const im = imgs[i];
    row.querySelectorAll<HTMLInputElement>('[data-alt]').forEach((input) =>
      input.addEventListener('change', async () => {
        const { error } = await sb.from('product_images').update({ [input.dataset.alt!]: orNull(input.value.trim()) }).eq('id', im.id);
        if (error) return fail(error, 'Beschrijving opslaan');
        setDirty(true);
        toast('Beschrijving opgeslagen.');
      }),
    );
    row.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
      b.addEventListener('click', async () => {
        const other = imgs[i + Number(b.dataset.move)];
        if (!other) return;
        // volgorde omwisselen; bij gelijke waarden de positie als nieuwe waarde gebruiken
        const a = im.sort === other.sort ? i : im.sort;
        const c = im.sort === other.sort ? i + Number(b.dataset.move) : other.sort;
        const r1 = await sb.from('product_images').update({ sort: c }).eq('id', im.id);
        const r2 = await sb.from('product_images').update({ sort: a }).eq('id', other.id);
        if (r1.error || r2.error) return fail(r1.error || r2.error, 'Volgorde aanpassen');
        setDirty(true);
        renderPhotos(box, productId, productName);
      }),
    );
    row.querySelector('[data-remove]')!.addEventListener('click', async () => {
      if (!confirm('Deze foto verwijderen?')) return;
      await sb.storage.from(IMAGE_BUCKET).remove([im.path_small, im.path_large]);
      const { error } = await sb.from('product_images').delete().eq('id', im.id);
      if (error) return fail(error, 'Foto verwijderen');
      setDirty(true);
      renderPhotos(box, productId, productName);
    });
  });
}

// ---------- drops ----------
async function viewDrops() {
  app.innerHTML = '<p class="muted">Drops laden…</p>';
  let drops: Drop[];
  try {
    drops = await loadDrops();
  } catch (e) {
    return fail(e, 'Drops laden');
  }
  const form = (d: Partial<Drop> | null) => `
    <form class="a-form a-card" data-drop-form data-id="${esc(d?.id ?? '')}" novalidate>
      <div class="a-row">
        <label class="a-field"><span>Naam (NL) *</span><input name="name_nl" value="${esc(d?.name_nl)}" required /></label>
        <label class="a-field"><span>Naam (EN)</span><input name="name_en" value="${esc(d?.name_en)}" /></label>
      </div>
      <div class="a-row">
        <label class="a-field"><span>Introtekst (NL)</span><textarea name="intro_nl">${esc(d?.intro_nl)}</textarea><small>${FORMAT_HELP}</small></label>
        <label class="a-field"><span>Introtekst (EN)</span><textarea name="intro_en">${esc(d?.intro_en)}</textarea></label>
      </div>
      <div class="a-row">
        <label class="a-field"><span>Webadres</span><input name="slug" value="${esc(d?.slug)}" placeholder="bijv. drop-02" /></label>
        <label class="a-field"><span>Volgorde</span><input name="sort" type="number" value="${esc(d?.sort ?? 0)}" /><small>Lager getal = eerder; de eerste drop staat op de homepage</small></label>
      </div>
      <label class="a-check"><input type="checkbox" name="published" ${d?.published ? 'checked' : ''} /> Zichtbaar op de website</label>
      <div class="a-buttons">
        <button class="btn btn-dark" type="submit">${d?.id ? 'Opslaan' : 'Drop aanmaken'}</button>
        ${d?.id ? '<button class="btn btn-danger" type="button" data-del>Verwijderen</button>' : ''}
      </div>
    </form>`;

  const hasCol = drops.length === 0 || 'image_path' in drops[0];
  const photo = (d: Drop) =>
    !hasCol
      ? '<p class="a-error">Een foto per drop kan pas na het SQL-script <strong>010_drop_fotos.sql</strong> in Supabase.</p>'
      : `
    <div class="a-card a-slot a-drop-photo" data-drop-photo="${esc(d.id)}">
      <div class="a-slot-img" style="aspect-ratio:4/3;max-width:320px">${d.image_path ? `<img src="${esc(publicImageUrl(d.image_path))}" alt="" />` : '<span>Nog geen foto</span>'}</div>
      <div class="a-slot-info">
        <strong>Foto in het Shop-menu</strong>
        <small class="muted">Liggend werkt het best (4:3). Zonder eigen foto toont het menu de hoofdfoto van het eerste product in deze drop.</small>
        <div class="a-buttons">
          <label class="btn btn-outline" style="cursor:pointer">${d.image_path ? 'Vervangen' : 'Foto kiezen'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-file /></label>
          ${d.image_path ? '<button type="button" class="a-link" data-remove>Verwijderen</button>' : ''}
        </div>
        <p class="a-note" data-progress></p>
      </div>
    </div>`;

  app.innerHTML = `
    <h1>Drops</h1>
    ${drops.map((d) => `<h2>${esc(d.name_nl)}</h2>${photo(d)}${form(d)}`).join('')}
    <h2>Nieuwe drop</h2>
    ${form(null)}`;

  app.querySelectorAll<HTMLElement>('[data-drop-photo]').forEach((card) => {
    const d = drops.find((x) => x.id === card.dataset.dropPhoto)!;
    const progress = card.querySelector<HTMLElement>('[data-progress]')!;
    card.querySelector<HTMLInputElement>('[data-file]')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      progress.textContent = 'Bezig met uploaden…';
      try {
        const blob = await resizeImage(file, 1200, 0.86);
        const path = `drops/${d.id}-${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (up.error) throw up.error;
        const { error } = await sb.from('drops').update({ image_path: path }).eq('id', d.id);
        if (error) throw error;
        if (d.image_path) await sb.storage.from(IMAGE_BUCKET).remove([d.image_path]);
        setDirty(true);
        toast('Foto opgeslagen.');
        viewDrops();
      } catch (err) {
        progress.textContent = '';
        fail(err, 'Uploaden');
      }
    });
    card.querySelector('[data-remove]')?.addEventListener('click', async () => {
      if (!confirm('Deze foto verwijderen?')) return;
      const { error } = await sb.from('drops').update({ image_path: null }).eq('id', d.id);
      if (error) return fail(error, 'Verwijderen');
      await sb.storage.from(IMAGE_BUCKET).remove([d.image_path!]);
      setDirty(true);
      viewDrops();
    });
  });

  app.querySelectorAll<HTMLFormElement>('[data-drop-form]').forEach((f) => {
    const id = f.dataset.id;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = val(f, 'name_nl');
      if (!name) return toast('De naam (NL) is verplicht.', true);
      const row = {
        name_nl: name,
        name_en: orNull(val(f, 'name_en')),
        intro_nl: orNull(val(f, 'intro_nl')),
        intro_en: orNull(val(f, 'intro_en')),
        slug: slugify(val(f, 'slug') || name),
        sort: parseInt(val(f, 'sort') || '0', 10) || 0,
        published: checked(f, 'published'),
      };
      const { error } = id ? await sb.from('drops').update(row).eq('id', id) : await sb.from('drops').insert(row);
      if (error) return fail(error.code === '23505' ? new Error('Dit webadres bestaat al.') : error, 'Drop opslaan');
      setDirty(true);
      toast('Drop opgeslagen.');
      viewDrops();
    });
    f.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Deze drop verwijderen? De producten blijven bestaan, maar horen dan bij geen drop meer.')) return;
      const { error } = await sb.from('drops').delete().eq('id', id!);
      if (error) return fail(error, 'Drop verwijderen');
      setDirty(true);
      viewDrops();
    });
  });
}

// ---------- instellingen ----------
async function viewSettings() {
  app.innerHTML = '<p class="muted">Laden…</p>';
  const [{ data, error }, snd] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).single(),
    sb.from('shipping_sender').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (error) return fail(error, 'Instellingen laden');
  const s: any = snd.data ?? {};
  app.innerHTML = `
    <h1>Instellingen</h1>
    <h2>Verzending</h2>
    <form class="a-form a-card" data-ship novalidate>
      <div class="a-row">
        <label class="a-field"><span>Verzendkosten Nederland (€)</span><input name="ship" inputmode="decimal" placeholder="bijv. 4,95" value="${esc(centsToInput(data.shipping_cents))}" /></label>
        <input type="hidden" name="ship_be" value="${esc(centsToInput(data.shipping_be_cents))}" /><p class="muted" style="align-self:end">Er wordt voorlopig alleen binnen Nederland verzonden.</p>
      </div>
      <div class="a-row">
        <label class="a-field"><span>Gratis verzending vanaf (€)</span><input name="free" inputmode="decimal" placeholder="leeg = nooit gratis" value="${esc(centsToInput(data.free_shipping_from_cents))}" /><small>Geldt voor het bedrag na korting</small></label>
        <label class="a-field"><span>Btw</span><select name="vat">
          <option value="incl21" ${data.vat_mode !== 'kor' ? 'selected' : ''}>Prijzen zijn inclusief 21% btw</option>
          <option value="kor" ${data.vat_mode === 'kor' ? 'selected' : ''}>KOR: geen btw (kleineondernemersregeling)</option></select>
          <small>Bepaalt alleen wat er op de bevestiging staat; de prijzen zelf veranderen niet.</small></label>
      </div>
      <p class="a-note">Zolang de verzendkosten voor Nederland leeg zijn, kunnen klanten nog niet afrekenen. Vul 0 in voor gratis verzending.</p>
      <div class="a-buttons"><button class="btn btn-dark" type="submit">Opslaan</button></div>
    </form>
    <h2>PostNL-label: afzender</h2>
    ${
      snd.error
        ? `<p class="a-note">Voer eerst <strong>supabase/migrations/011_postnl_emails.sql</strong> uit in Supabase.</p>`
        : `<form class="a-form a-card" data-sender novalidate>
      <div class="a-row">
        <label class="a-field"><span>Naam afzender</span><input name="company" placeholder="KNOOPZ" value="${esc(s.company)}" /></label>
        <label class="a-field"><span>Gewicht pakket (gram)</span><input name="weight" inputmode="numeric" value="${esc(s.weight_grams ?? 1000)}" /><small>Standaard voor elk label</small></label>
      </div>
      <div class="a-row a-row-3">
        <label class="a-field"><span>Straat</span><input name="street" value="${esc(s.street)}" /></label>
        <label class="a-field"><span>Huisnummer</span><input name="house_nr" inputmode="numeric" value="${esc(s.house_nr)}" /></label>
        <label class="a-field"><span>Toevoeging</span><input name="house_nr_ext" value="${esc(s.house_nr_ext)}" /></label>
      </div>
      <div class="a-row">
        <label class="a-field"><span>Postcode</span><input name="postal_code" value="${esc(s.postal_code)}" /></label>
        <label class="a-field"><span>Plaats</span><input name="city" value="${esc(s.city)}" /></label>
      </div>
      <p class="a-note">Dit adres komt als afzender op het PostNL-label en is alleen zichtbaar in het beheer. De PostNL API-sleutel en klantcode staan veilig in Cloudflare.</p>
      <div class="a-buttons"><button class="btn btn-dark" type="submit">Opslaan</button></div>
    </form>`
    }
    <h2>Mijn wachtwoord</h2>
    <form class="a-form a-card" data-pw novalidate>
      <div class="a-row">
        <label class="a-field"><span>Nieuw wachtwoord</span><input name="pw" type="password" autocomplete="new-password" minlength="12" /></label>
        <label class="a-field"><span>Herhaal wachtwoord</span><input name="pw2" type="password" autocomplete="new-password" minlength="12" /></label>
      </div>
      <p class="a-error" data-err hidden></p>
      <div class="a-buttons"><button class="btn btn-dark" type="submit">Wachtwoord wijzigen</button></div>
    </form>`;

  const ship = app.querySelector<HTMLFormElement>('[data-ship]')!;
  ship.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { error } = await sb
        .from('settings')
        .update({
          shipping_cents: parseEuro(val(ship, 'ship')),
          shipping_be_cents: parseEuro(val(ship, 'ship_be')),
          free_shipping_from_cents: parseEuro(val(ship, 'free')),
          vat_mode: val(ship, 'vat') === 'kor' ? 'kor' : 'incl21',
        })
        .eq('id', 1);
      if (error) throw error;
      toast('Opgeslagen. Dit geldt direct bij het afrekenen.');
    } catch (e) {
      fail(e, 'Opslaan');
    }
  });
  const sender = app.querySelector<HTMLFormElement>('[data-sender]');
  sender?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const weight = parseInt(val(sender, 'weight'), 10);
    if (!(weight >= 1 && weight <= 31500)) return toast('Vul een gewicht in tussen 1 en 31500 gram.', true);
    try {
      const { error } = await sb
        .from('shipping_sender')
        .update({
          company: orNull(val(sender, 'company')),
          street: orNull(val(sender, 'street')),
          house_nr: orNull(val(sender, 'house_nr')),
          house_nr_ext: orNull(val(sender, 'house_nr_ext')),
          postal_code: orNull(val(sender, 'postal_code').toUpperCase()),
          city: orNull(val(sender, 'city')),
          weight_grams: weight,
        })
        .eq('id', 1);
      if (error) throw error;
      toast('Afzender opgeslagen.');
    } catch (e) {
      fail(e, 'Opslaan');
    }
  });
  bindPasswordForm(app.querySelector<HTMLFormElement>('[data-pw]')!, () => {});
}

// ---------- e-mails ----------
type MailTexts = Record<string, Record<string, Record<string, string>>>;

async function viewEmails(key = 'confirmation', lang: 'nl' | 'en' = 'nl') {
  app.innerHTML = '<p class="muted">Laden…</p>';
  const { data, error } = await sb.from('email_templates').select('*');
  if (error) {
    app.innerHTML = `<h1>E-mails</h1><p class="a-note">Voer eerst <strong>supabase/migrations/011_postnl_emails.sql</strong> uit in Supabase.</p>`;
    return;
  }
  const own: MailTexts = {};
  for (const r of data as any[]) (own[r.key] ??= {})[r.lang] = { subject: r.subject, heading: r.heading, body: r.body, button: r.button };

  const tpl = TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0];
  if (tpl.nlOnly) lang = 'nl';
  const defaults = (DEFAULTS as any)[tpl.key]?.[lang] ?? (DEFAULTS as any)[tpl.key].nl;
  const current = (f: string) => own[tpl.key]?.[lang]?.[f] || defaults[f] || '';
  const changed = tpl.fields.some((f) => own[tpl.key]?.[lang]?.[f]);

  app.innerHTML = `
    <h1>E-mails</h1>
    <p class="a-note">Pas hier de teksten aan van de mails die automatisch worden verstuurd. Het voorbeeld rechts laat zien hoe de mail eruitziet (met een voorbeeldbestelling).</p>
    <div class="a-filters a-mail-tabs" role="group" aria-label="Kies een e-mail">
      ${TEMPLATES.map((t) => `<button class="filter" aria-pressed="${t.key === tpl.key}" data-key="${t.key}">${esc(t.title)}</button>`).join('')}
    </div>
    <div class="a-mail">
      <form class="a-form a-card" data-mail novalidate>
        <p class="a-note"><strong>Naar:</strong> ${esc(tpl.to)} · <strong>Wanneer:</strong> ${esc(tpl.when)}${changed ? ' · <span class="a-pill">Aangepast</span>' : ''}</p>
        ${
          tpl.nlOnly
            ? ''
            : `<div class="a-filters" role="group" aria-label="Taal">
          <button type="button" class="filter" aria-pressed="${lang === 'nl'}" data-lang="nl">Nederlands</button>
          <button type="button" class="filter" aria-pressed="${lang === 'en'}" data-lang="en">Engels</button>
        </div>`
        }
        ${tpl.fields
          .map((f) =>
            f === 'body'
              ? `<label class="a-field"><span>${(FIELD_LABELS as any)[f]}</span><textarea name="${f}" rows="${tpl.key === 'footer' ? 5 : 8}">${esc(current(f))}</textarea></label>`
              : `<label class="a-field"><span>${(FIELD_LABELS as any)[f]}</span><input name="${f}" value="${esc(current(f))}" /></label>`,
          )
          .join('')}
        <p class="a-note">Opmaak: <strong>**woord**</strong> = dikgedrukt, witregel = nieuwe alinea. Deze woorden worden automatisch ingevuld:<br>
        ${PLACEHOLDERS.map(([k, d]) => `<code>${esc(k)}</code> ${esc(d)}`).join('<br>')}</p>
        <div class="a-buttons">
          <button class="btn btn-dark" type="submit">Opslaan</button>
          ${changed ? '<button class="btn btn-outline" type="button" data-reset>Standaardtekst terugzetten</button>' : ''}
        </div>
      </form>
      <div class="a-mail-preview">
        <p class="a-note" data-subject></p>
        <iframe title="Voorbeeld van de e-mail" data-preview></iframe>
      </div>
    </div>
    <h2>Testmails</h2>
    <form class="a-form a-card" data-test novalidate>
      <p class="a-note">Stuurt alle mails (Nederlands en Engels) met een voorbeeldbestelling naar dit adres, met de teksten zoals ze nu zijn opgeslagen.</p>
      <div class="a-row">
        <label class="a-field"><span>Naar</span><input name="to" type="email" value="knoopz.contact@gmail.com" /></label>
        <div class="a-buttons" style="align-self:end"><button class="btn btn-dark" type="submit">Stuur testmails</button></div>
      </div>
    </form>`;

  const form = app.querySelector<HTMLFormElement>('[data-mail]')!;
  const frame = app.querySelector<HTMLIFrameElement>('[data-preview]')!;
  const subjectEl = app.querySelector<HTMLElement>('[data-subject]')!;
  const draft = (): MailTexts => {
    const d: MailTexts = JSON.parse(JSON.stringify(own));
    (d[tpl.key] ??= {})[lang] = Object.fromEntries(tpl.fields.map((f) => [f, val(form, f)]));
    return d;
  };
  const preview = () => {
    // De afsluiting staat in elke klantmail; laat hem zien in de bevestiging
    const show = tpl.key === 'footer' ? 'confirmation' : tpl.key;
    const m = renderEmail(show as any, { ...SAMPLE_ORDER, lang }, draft(), { origin: location.origin, adminUrl: `${location.origin}/admin/` });
    subjectEl.innerHTML = `<strong>Onderwerp:</strong> ${esc(m.subject)}`;
    frame.srcdoc = m.html;
  };
  let timer = 0;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(preview, 250);
  });
  preview();

  app.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) => b.addEventListener('click', () => viewEmails(b.dataset.key!, lang)));
  app.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.addEventListener('click', () => viewEmails(tpl.key, b.dataset.lang as 'nl' | 'en')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Gelijk aan de standaardtekst? Dan niets opslaan, zodat verbeteringen in de standaard vanzelf meekomen.
    const row: Record<string, string | null> = { key: tpl.key, lang };
    for (const f of tpl.fields) {
      const v = val(form, f);
      row[f] = v && v !== defaults[f] ? v : null;
    }
    try {
      const { error } = await sb.from('email_templates').upsert(row);
      if (error) throw error;
      toast('Opgeslagen. Nieuwe mails gebruiken deze tekst direct.');
      viewEmails(tpl.key, lang);
    } catch (err) {
      fail(err, 'Opslaan');
    }
  });
  const test = app.querySelector<HTMLFormElement>('[data-test]')!;
  test.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = test.querySelector<HTMLButtonElement>('button')!;
    btn.disabled = true;
    try {
      const r = await adminPost('/api/admin/test-mail', { to: val(test, 'to') });
      toast(r.ok ? `${r.sent} testmails verstuurd naar ${val(test, 'to')}.` : `${r.sent} van de ${r.total} testmails verstuurd.`, !r.ok);
    } catch (err) {
      const m = String((err as Error).message);
      fail(m === 'mail_not_set' ? new Error('E-mail is nog niet ingesteld in Cloudflare (RESEND_API_KEY en MAIL_FROM).') : m === 'email' ? new Error('Vul een geldig e-mailadres in.') : err, 'Testmails');
    }
    btn.disabled = false;
  });
  app.querySelector('[data-reset]')?.addEventListener('click', async () => {
    if (!confirm('De standaardtekst terugzetten? Je eigen tekst voor deze mail verdwijnt.')) return;
    const { error } = await sb.from('email_templates').delete().eq('key', tpl.key).eq('lang', lang);
    if (error) return fail(error, 'Terugzetten');
    toast('Standaardtekst teruggezet.');
    viewEmails(tpl.key, lang);
  });
}

// ---------- bestellingen ----------
const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Betaald · te verzenden', cls: 'todo' },
  shipped: { label: 'Verzonden', cls: '' },
  delivered: { label: 'Bezorgd', cls: 'done' },
  pending: { label: 'Wacht op betaling', cls: 'hidden' },
  cancelled: { label: 'Geannuleerd', cls: 'hidden' },
  expired: { label: 'Verlopen', cls: 'hidden' },
  failed: { label: 'Mislukt', cls: 'hidden' },
};
const statusPill = (s: string) => `<span class="a-pill ${STATUS[s]?.cls ?? ''}">${esc(STATUS[s]?.label ?? s)}</span>`;
const dateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

async function viewOrders() {
  app.innerHTML = '<p class="muted">Bestellingen laden…</p>';
  const { data, error } = await sb
    .from('orders')
    .select('*') // ook als een migratie (bijv. 011 PostNL) nog niet is uitgevoerd
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return fail(error, 'Bestellingen laden');
  let rows = data as any[];
  const live = () => rows.filter((r) => !r.deleted_at);
  const trashCount = () => rows.length - live().length;
  const counts = { todo: live().filter((r) => r.status === 'paid').length };

  app.innerHTML = `
    <h1>Bestellingen</h1>
    <div class="a-toolbar">
      <input class="a-search" type="search" placeholder="Zoek op nummer, naam of e-mail" aria-label="Zoek bestellingen" data-q />
      <div class="a-filters" role="group" aria-label="Filter">
        <button class="filter" aria-pressed="true" data-f="todo">Te verzenden (${counts.todo})</button>
        <button class="filter" aria-pressed="false" data-f="shipped">Onderweg</button>
        <button class="filter" aria-pressed="false" data-f="delivered">Bezorgd</button>
        <button class="filter" aria-pressed="false" data-f="paidall">Alle betaalde</button>
        <button class="filter" aria-pressed="false" data-f="open">Niet betaald</button>
        <button class="filter" aria-pressed="false" data-f="trash">Prullenbak (<span data-trash-n>${trashCount()}</span>)</button>
      </div>
    </div>
    <div class="a-bulk">
      <p class="a-note" data-count></p>
      <div class="a-buttons" data-bulk hidden>
        <button class="btn btn-outline" type="button" data-act="trash">Naar prullenbak</button>
        <button class="btn btn-outline" type="button" data-act="restore">Terugzetten</button>
        <button class="btn btn-danger" type="button" data-act="purge">Definitief verwijderen</button>
      </div>
    </div>
    <div class="a-scroll">
      <table class="a-table">
        <thead><tr><th class="a-sel"><input type="checkbox" aria-label="Alles selecteren" data-all /></th><th>Nummer</th><th class="hide-sm" data-date-head>Datum</th><th>Klant</th><th>Totaal</th><th>Status</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>
    <p class="a-note">Niet-betaalde bestellingen zijn klanten die zijn gaan afrekenen maar (nog) niet betaald hebben. Die stukken zijn na 15 minuten automatisch weer te koop.</p>`;

  const tbody = app.querySelector<HTMLElement>('[data-rows]')!;
  const q = app.querySelector<HTMLInputElement>('[data-q]')!;
  let filter = 'todo';
  const selected = new Set<string>();
  let list: any[] = [];
  const bulk = app.querySelector<HTMLElement>('[data-bulk]')!;
  const allBox = app.querySelector<HTMLInputElement>('[data-all]')!;
  const syncBulk = () => {
    bulk.hidden = selected.size === 0;
    bulk.querySelector<HTMLElement>('[data-act="trash"]')!.hidden = filter === 'trash';
    bulk.querySelector<HTMLElement>('[data-act="restore"]')!.hidden = filter !== 'trash';
    bulk.querySelector<HTMLElement>('[data-act="purge"]')!.hidden = filter !== 'trash';
    allBox.checked = list.length > 0 && list.every((r) => selected.has(r.id));
  };
  const render = () => {
    const term = q.value.trim().toLowerCase();
    list = rows.filter((r) => {
      if (term && !`${r.number} ${r.first_name} ${r.last_name} ${r.email}`.toLowerCase().includes(term)) return false;
      if (filter === 'trash') return !!r.deleted_at;
      if (r.deleted_at) return false;
      if (filter === 'todo') return r.status === 'paid';
      if (filter === 'shipped') return r.status === 'shipped';
      if (filter === 'delivered') return r.status === 'delivered';
      if (filter === 'paidall') return PAID.includes(r.status);
      return !PAID.includes(r.status);
    });
    app.querySelector('[data-count]')!.textContent = `${list.length} bestelling${list.length === 1 ? '' : 'en'}`;
    tbody.innerHTML = list.length
      ? list
          .map(
            (r) => `<tr>
          <td class="a-sel"><input type="checkbox" aria-label="Selecteer ${esc(r.number)}" data-sel="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''} /></td>
          <td><a href="#/bestelling/${esc(r.id)}">${esc(r.number)}</a>${r.needs_attention ? ' <span class="a-pill sold" title="Actie nodig">!</span>' : ''}</td>
          <td class="hide-sm">${esc(dateTime(filter === 'trash' ? r.deleted_at : (r.paid_at ?? r.created_at)))}</td>
          <td>${esc(r.first_name)} ${esc(r.last_name)}</td>
          <td>${esc(euro(r.total_cents))}</td>
          <td>${statusPill(r.status)}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="6" class="muted">${filter === 'trash' ? 'De prullenbak is leeg.' : 'Geen bestellingen.'}</td></tr>`;
    app.querySelector('[data-date-head]')!.textContent = filter === 'trash' ? 'Verwijderd op' : 'Datum';
    tbody.querySelectorAll<HTMLInputElement>('[data-sel]').forEach((c) =>
      c.addEventListener('change', () => {
        c.checked ? selected.add(c.dataset.sel!) : selected.delete(c.dataset.sel!);
        syncBulk();
      }),
    );
    syncBulk();
  };
  allBox.addEventListener('change', () => {
    list.forEach((r) => (allBox.checked ? selected.add(r.id) : selected.delete(r.id)));
    render();
  });
  bulk.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ids = [...selected].filter((id) => list.some((r) => r.id === id));
      if (!ids.length) return;
      const ok = await orderAction(b.dataset.act as OrderAct, ids, rows.filter((r) => ids.includes(r.id)));
      if (!ok) return;
      selected.clear();
      const { data: fresh } = await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(500);
      if (fresh) rows = fresh as any[];
      app.querySelector('[data-trash-n]')!.textContent = String(trashCount());
      render();
    }),
  );
  q.addEventListener('input', render);
  app.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f!;
      selected.clear();
      app.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    }),
  );
  render();

  // Bij PostNL navragen of verzonden pakketten intussen bezorgd zijn
  if (rows.some((r) => r.status === 'shipped' && r.postnl_barcode)) {
    const r = await adminPost('/api/admin/track', {}).catch(() => null);
    if (r?.delivered?.length && location.hash.startsWith('#/bestellingen')) {
      rows.forEach((x) => r.delivered.includes(x.id) && (x.status = 'delivered'));
      render();
      toast(`${r.delivered.length} pakket${r.delivered.length === 1 ? ' is' : 'ten zijn'} bezorgd.`);
    }
  }
}

const PAID = ['paid', 'shipped', 'delivered'];

// Prullenbak: naar prullenbak, terugzetten of (alleen vanuit de prullenbak) definitief verwijderen.
type OrderAct = 'trash' | 'restore' | 'purge';
async function orderAction(act: OrderAct, ids: string[], orders: any[]): Promise<boolean> {
  const n = ids.length;
  const what = n === 1 ? `bestelling ${orders[0]?.number ?? ''}` : `${n} bestellingen`;
  const paidN = orders.filter((o) => PAID.includes(o.status)).length;
  if (act === 'trash') {
    const warn = paidN ? `\n\nLet op: ${paidN === 1 ? 'er is er één' : `er zijn er ${paidN}`} betaald. Verwijder alleen testbestellingen.` : '';
    if (!confirm(`${what} naar de prullenbak verplaatsen? Je kunt ${n === 1 ? 'hem' : 'ze'} daar terugzetten.${warn}`)) return false;
  }
  if (act === 'purge' && !confirm(`${what} definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return false;
  const q =
    act === 'purge'
      ? sb.from('orders').delete().in('id', ids).select('id')
      : sb
          .from('orders')
          .update(act === 'trash' ? { deleted_at: new Date().toISOString(), deleted_by: session?.user.email ?? null } : { deleted_at: null, deleted_by: null })
          .in('id', ids);
  const { data: changed, error } = await q;
  if (error) {
    if (/deleted_(at|by)/.test(error.message)) toast('Voer eerst migratie 013_prullenbak_bezoekstappen.sql uit in Supabase.', true);
    else fail(error, 'Bestellingen bijwerken');
    return false;
  }
  if (act === 'purge') {
    const done = (changed ?? []).length;
    if (done < n) {
      toast(`${n - done === 1 ? 'Eén bestelling is' : `${n - done} bestellingen zijn`} nog niet verwijderd: daar is iemand nog aan het afrekenen. Probeer het over een kwartier opnieuw.`, true);
      return done > 0;
    }
  }
    toast(act === 'trash' ? `${what} in de prullenbak gezet.` : act === 'restore' ? `${what} teruggezet.` : `${what} definitief verwijderd.`);
  return true;
}

// ---------- overzicht (verkoopcijfers) ----------
const PERIODS: Record<string, { label: string; days: number | null }> = {
  '7': { label: '7 dagen', days: 7 },
  '30': { label: '30 dagen', days: 30 },
  '365': { label: '12 maanden', days: 365 },
  all: { label: 'Alles', days: null },
};

async function viewStats() {
  app.innerHTML = '<p class="muted">Cijfers laden…</p>';
  const { data, error } = await sb
    .from('orders')
    .select('*,order_items(name,price_cents,product_id)') // ook als migratie 013 (prullenbak) nog niet is uitgevoerd
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return fail(error, 'Cijfers laden');
  const all = (data as any[]).filter((r) => !r.deleted_at);
  const { data: stepRows, error: stepError } = await sb.from('visit_steps').select('day,step,n');
  const { data: prodSteps, error: prodError } = await sb.from('product_steps').select('day,product_id,step,n');
  const { data: prods } = await sb.from('products').select('id,code,name_nl,published');
  let period = '30';
  let sortBy: 'most' | 'least' | 'sold' = 'most';
  const when = (r: any) => new Date(r.paid_at ?? r.created_at).getTime();

  app.innerHTML = `
    <h1>Overzicht</h1>
    <div class="a-toolbar">
      <div class="a-filters" role="group" aria-label="Periode">
        ${Object.entries(PERIODS)
          .map(([k, p]) => `<button class="filter" aria-pressed="${k === '30'}" data-p="${k}">${p.label}</button>`)
          .join('')}
      </div>
    </div>
    <div data-stats></div>
    <p class="a-note">Bezoekers (aantallen, pagina's, waar ze vandaan komen) zie je in Cloudflare: Workers &amp; Pages → het Knoopz-project → Metrics → Web Analytics.</p>`;

  const box = app.querySelector<HTMLElement>('[data-stats]')!;
  const render = (key: string) => {
    period = key;
    const days = PERIODS[key].days;
    const from = days ? Date.now() - days * 86400000 : 0;
    const inPeriod = all.filter((r) => when(r) >= from);
    const paid = inPeriod.filter((r) => PAID.includes(r.status));
    const unpaid = inPeriod.filter((r) => !PAID.includes(r.status)).length;
    const sum = (list: any[], f: (r: any) => number) => list.reduce((t, r) => t + (f(r) || 0), 0);
    const revenue = sum(paid, (r) => r.total_cents);
    const items = paid.flatMap((r) => r.order_items ?? []);

    const products = new Map<string, { n: number; cents: number }>();
    items.forEach((i) => {
      const p = products.get(i.name) ?? { n: 0, cents: 0 };
      p.n++;
      p.cents += i.price_cents;
      products.set(i.name, p);
    });
    const codes = new Map<string, { n: number; cents: number }>();
    paid.filter((r) => r.discount_code).forEach((r) => {
      const c = codes.get(r.discount_code) ?? { n: 0, cents: 0 };
      c.n++;
      c.cents += r.discount_cents;
      codes.set(r.discount_code, c);
    });
    const months = new Map<string, { n: number; cents: number }>();
    const monthFmt = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });
    paid.forEach((r) => {
      const m = monthFmt.format(new Date(when(r)));
      const x = months.get(m) ?? { n: 0, cents: 0 };
      x.n++;
      x.cents += r.total_cents;
      months.set(m, x);
    });

    const tile = (label: string, value: string, sub = '') =>
      `<div class="a-card a-stat"><span class="label">${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const table = (head: string[], rows: string[][], empty: string) => `
      <div class="a-scroll"><table class="a-table">
        <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="muted">${empty}</td></tr>`}</tbody>
      </table></div>`;
    const tried = paid.length + unpaid;

    // Trechter: waar haken bezoekers af
    const fromDay = days ? new Date(from).toISOString().slice(0, 10) : '';
    const stepN = (step: string) => (stepRows ?? []).filter((r: any) => r.step === step && r.day >= fromDay).reduce((t: number, r: any) => t + r.n, 0);
    const funnel: [string, number][] = [
      ['Bezoek', stepN('visit')],
      ['Product bekeken', stepN('product')],
      ['In winkelwagen', stepN('cart')],
      ['Afrekenpagina', stepN('checkout')],
      ['Naar betalen', stepN('pay')],
      ['Betaald', paid.length],
    ];
    const top = funnel[0][1];

    // Per product: bekeken, in winkelwagen, verkocht (alle gepubliceerde producten, ook zonder weergaven)
    const per = new Map<string, { name: string; views: number; cart: number; sold: number }>();
    (prods ?? []).forEach((p: any) => {
      if (p.published) per.set(p.id, { name: `${p.name_nl} (${p.code})`, views: 0, cart: 0, sold: 0 });
    });
    (prodSteps ?? []).forEach((r: any) => {
      const x = per.get(r.product_id);
      if (x && r.day >= fromDay) r.step === 'view' ? (x.views += r.n) : (x.cart += r.n);
    });
    items.forEach((i) => {
      const x = per.get(i.product_id);
      if (x) x.sold++;
    });
    const perList = [...per.values()].sort((a, b) =>
      sortBy === 'least' ? a.views - b.views || a.cart - b.cart : sortBy === 'sold' ? b.sold - a.sold || b.views - a.views : b.views - a.views || b.cart - a.cart,
    );
    const sortBtn = (k: typeof sortBy, label: string) => `<button class="filter" aria-pressed="${sortBy === k}" data-sort="${k}">${label}</button>`;
    const productHtml = prodError
      ? '<p class="a-note">Voer eerst migratie 014_productweergaven.sql uit in Supabase, dan wordt per product bijgehouden hoe vaak het bekeken is.</p>'
      : `<div class="a-filters a-sortbar" role="group" aria-label="Sorteren">${sortBtn('most', 'Meest bekeken')}${sortBtn('least', 'Minst bekeken')}${sortBtn('sold', 'Meest verkocht')}</div>
        ${table(
          ['Product', 'Bekeken', 'In winkelwagen', 'Verkocht'],
          perList.map((x) => [esc(x.name), String(x.views), String(x.cart), String(x.sold)]),
          'Geen gepubliceerde producten.',
        )}
        <p class="a-note">Alleen producten die nu op de website staan. Elke bezoeker telt één keer per product per bezoek. Het meten loopt sinds migratie 014 is uitgevoerd.</p>`;
    const funnelHtml = stepError
      ? '<p class="a-note">Voer eerst migratie 013_prullenbak_bezoekstappen.sql uit in Supabase, dan wordt dit bijgehouden.</p>'
      : `${table(
          ['Stap', 'Aantal', '', 'Afgehaakt'],
          funnel.map(([label, n], i) => {
            const pct = top ? Math.min(100, Math.round((n / top) * 100)) : 0;
            const prev = i ? funnel[i - 1][1] : 0;
            const lost = i && prev ? Math.max(0, Math.round(((prev - n) / prev) * 100)) : null;
            return [label, String(n), `<span class="a-bar"><span style="width:${pct}%"></span></span>`, lost === null ? '' : `${lost}%`];
          }),
          '',
        )}
        <p class="a-note">Elke stap telt één keer per bezoek. "Afgehaakt" is het deel dat na de vorige stap niet verder ging. Het meten loopt sinds migratie 013 is uitgevoerd.</p>`;

    box.innerHTML = `
      <div class="a-stats">
        ${tile('Omzet', esc(euro(revenue)), 'incl. verzending en btw')}
        ${tile('Bestellingen', String(paid.length), paid.length ? `gemiddeld ${esc(euro(Math.round(revenue / paid.length)))}` : '')}
        ${tile('Verkochte stuks', String(items.length))}
        ${tile('Afgerond', tried ? `${Math.round((paid.length / tried) * 100)}%` : '—', `${unpaid} afgehaakt bij betalen`)}
      </div>
      <h2>Waar haken bezoekers af</h2>
      ${funnelHtml}
      <h2>Per product</h2>
      ${productHtml}
      <h2>Best verkocht</h2>
      ${table(
        ['Product', 'Stuks', 'Omzet'],
        [...products.entries()].sort((a, b) => b[1].n - a[1].n || b[1].cents - a[1].cents).slice(0, 15).map(([name, p]) => [esc(name), String(p.n), esc(euro(p.cents))]),
        'Nog niets verkocht in deze periode.',
      )}
      <h2>Per maand</h2>
      ${table(['Maand', 'Bestellingen', 'Omzet'], [...months.entries()].map(([m, x]) => [esc(m), String(x.n), esc(euro(x.cents))]), 'Geen bestellingen.')}
      <h2>Kortingscodes</h2>
      ${table(
        ['Code', 'Gebruikt', 'Korting gegeven'],
        [...codes.entries()].sort((a, b) => b[1].n - a[1].n).map(([c, x]) => [esc(c), String(x.n), esc(euro(x.cents))]),
        'Geen kortingscodes gebruikt.',
      )}
      <h2>Land</h2>
      ${table(
        ['Land', 'Bestellingen', 'Omzet'],
        ['NL', 'BE'].map((c) => {
          const l = paid.filter((r) => r.country === c);
          return [c === 'NL' ? 'Nederland' : 'België', String(l.length), esc(euro(sum(l, (r) => r.total_cents)))];
        }),
        '',
      )}`;
    box.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) =>
      b.addEventListener('click', () => {
        sortBy = b.dataset.sort as typeof sortBy;
        render(period);
      }),
    );
  };

  app.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) =>
    b.addEventListener('click', () => {
      app.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render(b.dataset.p!);
    }),
  );
  render('30');
}

// Is PostNL ingesteld in Cloudflare? Zo niet, dan werkt verzenden zoals vroeger (handmatig).
let postnlOn: Promise<boolean> | null = null;
function postnlReady() {
  postnlOn ??= sb.auth.getSession().then(async ({ data }) => {
    const res = await fetch('/api/admin/config', { headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` } });
    return res.ok ? (await res.json()).postnl === true : false;
  }).catch(() => false);
  return postnlOn;
}

// POST naar een beheer-endpoint met het token van de ingelogde beheerder
async function adminPost(url: string, body: unknown) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error === 'forbidden' ? 'geen toegang' : r.message || r.error || `fout ${res.status}`);
  return r;
}

function downloadPdf(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function viewOrder(id: string) {
  app.innerHTML = '<p class="muted">Laden…</p>';
  const { data: o, error } = await sb.from('orders').select('*,order_items(*)').eq('id', id).single();
  if (error) return fail(error, 'Bestelling laden');
  const countries: Record<string, string> = { NL: 'Nederland', BE: 'België' };
  const addressText = `${o.first_name} ${o.last_name}\n${o.street}\n${o.postal_code} ${o.city}\n${countries[o.country] ?? o.country}`;
  const canShip = o.status === 'paid' || o.status === 'shipped';
  const hasLabel = !!o.postnl_barcode;
  const usePostnl = hasLabel || (await postnlReady());
  const PARCEL: Record<string, string> = { package: 'Pakket', mailbox: 'Brievenbuspakje' };
  let parcel: 'package' | 'mailbox' = 'package';
  const pids = (o.order_items as any[]).map((i) => i.product_id).filter(Boolean);
  if (!hasLabel && pids.length) {
    const { data: prods } = await sb.from('products').select('*').in('id', pids);
    if (prods?.length === pids.length && prods.every((x) => parcelOf(x) === 'mailbox')) parcel = 'mailbox';
  }

  app.innerHTML = `
    <p><a href="#/bestellingen">← Terug naar bestellingen</a></p>
    <h1>${esc(o.number)} ${statusPill(o.status)}</h1>
    ${
      o.deleted_at
        ? `<div class="a-attention"><p>Deze bestelling staat in de prullenbak (verwijderd op ${esc(dateTime(o.deleted_at))}${o.deleted_by ? ` door ${esc(o.deleted_by)}` : ''}).</p><div class="a-buttons"><button class="btn btn-outline" data-order-act="restore">Terugzetten</button><button class="btn btn-danger" data-order-act="purge">Definitief verwijderen</button></div></div>`
        : ''
    }
    ${o.needs_attention ? `<div class="a-attention"><p>${esc(o.needs_attention)}</p><button class="btn btn-outline" data-resolve>Opgelost</button></div>` : ''}
    <div class="a-row">
      <div class="a-card">
        <h2>Klant en bezorgadres</h2>
        <p class="a-address">${esc(addressText).replace(/\n/g, '<br>')}</p>
        <p><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></p>
        <div class="a-buttons"><button class="btn btn-outline" type="button" data-copy>Adres kopiëren</button></div>
      </div>
      <div class="a-card">
        <h2>Betaling</h2>
        <dl class="a-dl">
          <div><dt>Besteld</dt><dd>${esc(dateTime(o.created_at))}</dd></div>
          <div><dt>Betaald</dt><dd>${esc(dateTime(o.paid_at))}</dd></div>
          <div><dt>Methode</dt><dd>${esc(o.payment_method ?? '—')}</dd></div>
          <div><dt>Mollie-id</dt><dd>${esc(o.mollie_payment_id ?? '—')}</dd></div>
          <div><dt>Verzonden</dt><dd>${esc(dateTime(o.shipped_at))}</dd></div>
          <div><dt>Bezorgd</dt><dd>${esc(dateTime(o.delivered_at))}</dd></div>
          <div><dt>Taal klant</dt><dd>${o.lang === 'en' ? 'Engels' : 'Nederlands'}</dd></div>
        </dl>
      </div>
    </div>
    <h2>Artikelen</h2>
    <div class="a-scroll"><table class="a-table">
      <thead><tr><th>Code</th><th>Naam</th><th>Prijs</th></tr></thead>
      <tbody>
        ${(o.order_items as any[]).map((i) => `<tr><td>${esc(i.code)}</td><td>${i.product_id ? `<a href="#/product/${esc(i.product_id)}">${esc(i.name)}</a>` : esc(i.name)}</td><td>${esc(euro(i.price_cents))}</td></tr>`).join('')}
        <tr><td></td><td>Subtotaal</td><td>${esc(euro(o.subtotal_cents))}</td></tr>
        ${o.discount_cents ? `<tr><td></td><td>Korting${o.discount_code ? ` (${esc(o.discount_code)})` : ''}</td><td>− ${esc(euro(o.discount_cents))}</td></tr>` : ''}
        <tr><td></td><td>Verzending (${esc(countries[o.country] ?? o.country)})</td><td>${esc(euro(o.shipping_cents))}</td></tr>
        <tr><td></td><td><strong>Totaal</strong></td><td><strong>${esc(euro(o.total_cents))}</strong></td></tr>
      </tbody>
    </table></div>
    <p class="a-note">${o.vat_mode === 'kor' ? 'KOR: geen btw berekend.' : `Waarvan btw (21%): ${esc(euro(o.vat_cents))}`}</p>
    ${
      PAID.includes(o.status)
        ? `${
      usePostnl
        ? `<h2>Verzending</h2>
    <div class="a-card a-ship">
      ${
        hasLabel
          ? `<dl class="a-dl">
        <div><dt>Status</dt><dd>${o.status === 'delivered' ? `<strong>Bezorgd</strong> · ${esc(dateTime(o.delivered_at))}` : 'Onderweg met PostNL'}</dd></div>
        <div><dt>Soort</dt><dd>${esc(PARCEL[o.parcel_type] ?? '—')}</dd></div>
        <div><dt>Barcode</dt><dd>${esc(o.postnl_barcode)}</dd></div>
        <div><dt>Track &amp; trace</dt><dd>${o.tracking_url ? `<a href="${esc(o.tracking_url)}" target="_blank" rel="noopener">Open bij PostNL</a>` : '—'}</dd></div>
      </dl>
      <div class="a-buttons"><button class="btn btn-dark" type="button" data-pdf>Label downloaden (PDF)</button>${o.status === 'shipped' ? '<button class="btn btn-outline" type="button" data-track>Bezorgstatus controleren</button>' : ''}</div>`
          : `<p>Maak het PostNL-verzendlabel aan. Je krijgt direct een PDF om te printen, de bestelling gaat op <strong>verzonden</strong> en de klant krijgt de mail <em>"Je bestelling is onderweg"</em> met de track &amp; trace.</p>
      <label class="a-field"><span>Verzenden als</span><select data-parcel>
        <option value="package" ${parcel === 'package' ? 'selected' : ''}>Pakket</option>
        <option value="mailbox" ${parcel === 'mailbox' ? 'selected' : ''}>Brievenbuspakje</option></select>
        <small>Automatisch gekozen op basis van de producten; pas aan als het anders moet.</small></label>
      <div class="a-buttons"><button class="btn btn-dark" type="button" data-label>Label aanmaken</button></div>`
      }
    </div>`
        : ''
    }
    ${
      canShip && !hasLabel
        ? `${usePostnl ? '<details class="a-details"><summary>Zonder PostNL-label verzenden (handmatig)</summary>' : '<h2>Verzending</h2>'}
    <form class="a-form a-card" data-ship novalidate>
      <label class="a-field"><span>Track &amp; trace-link (optioneel)</span><input name="tracking" type="url" placeholder="https://..." value="${esc(o.tracking_url)}" /></label>
      <label class="a-check"><input type="checkbox" name="notify" checked /> Stuur de klant een e-mail dat het pakket onderweg is</label>
      <div class="a-buttons"><button class="btn ${usePostnl ? 'btn-outline' : 'btn-dark'}" type="submit">${o.status === 'shipped' ? 'Verzendgegevens bijwerken' : 'Markeer als verzonden'}</button></div>
    </form>${usePostnl ? '</details>' : ''}`
        : ''
    }`
        : ''
    }`;

  app.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(addressText);
      toast('Adres gekopieerd.');
    } catch {
      toast('Kopiëren lukt niet in deze browser.', true);
    }
  });
  app.querySelector('[data-resolve]')?.addEventListener('click', async () => {
    const { error } = await sb.from('orders').update({ needs_attention: null }).eq('id', id);
    if (error) return fail(error, 'Opslaan');
    viewOrder(id);
  });
  if (!o.deleted_at)
    app.insertAdjacentHTML('beforeend', '<div class="a-buttons a-trash"><button class="btn btn-outline" type="button" data-order-act="trash">Naar prullenbak</button></div>');
  app.querySelectorAll<HTMLButtonElement>('[data-order-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const act = b.dataset.orderAct as OrderAct;
      if (!(await orderAction(act, [id], [o]))) return;
      if (act === 'restore') viewOrder(id);
      else location.hash = '#/bestellingen';
    }),
  );
  const labelBtn = app.querySelector<HTMLButtonElement>('[data-label]');
  labelBtn?.addEventListener('click', async () => {
    const chosen = app.querySelector<HTMLSelectElement>('[data-parcel]')!.value;
    if (!confirm(`${PARCEL[chosen]}-label aanmaken voor ${o.number}? De klant krijgt daarna direct de mail dat het pakket onderweg is.`)) return;
    labelBtn.disabled = true;
    labelBtn.textContent = 'Label aanmaken…';
    try {
      const r = await adminPost('/api/admin/label', { order_id: id, parcel: chosen });
      downloadPdf(r.pdf, `${o.number}-postnl-label.pdf`);
      toast(r.mailed ? 'Label aangemaakt en de klant is gemaild.' : r.mailEnabled === false ? 'Label aangemaakt. (E-mails zijn nog niet ingesteld.)' : 'Label aangemaakt.');
      viewOrder(id);
    } catch (err) {
      const msg = String((err as Error).message);
      fail(msg === 'postnl_not_set' ? new Error('PostNL is nog niet ingesteld in Cloudflare (POSTNL_API_KEY, klantcode en klantnummer).') : err, 'Label aanmaken');
      labelBtn.disabled = false;
      labelBtn.textContent = 'Label aanmaken';
    }
  });
  app.querySelector('[data-pdf]')?.addEventListener('click', async () => {
    const { data, error } = await sb.from('shipping_labels').select('pdf_base64').eq('order_id', id).maybeSingle();
    if (error || !data) return fail(error ?? new Error('label niet gevonden'), 'Label downloaden');
    downloadPdf(data.pdf_base64, `${o.number}-postnl-label.pdf`);
  });
  app.querySelector('[data-track]')?.addEventListener('click', async () => {
    try {
      const r = await adminPost('/api/admin/track', {});
      if (r.delivered?.includes(id)) {
        toast('Bezorgd!');
        viewOrder(id);
      } else toast('Nog niet bezorgd volgens PostNL.');
    } catch (err) {
      fail(err, 'Status controleren');
    }
  });
  const shipForm = app.querySelector<HTMLFormElement>('[data-ship]');
  shipForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = shipForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    try {
      const { data } = await sb.auth.getSession();
      const res = await fetch('/api/admin/ship', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ order_id: id, tracking: val(shipForm, 'tracking'), notify: checked(shipForm, 'notify') }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error === 'forbidden' ? 'geen toegang' : r.error || `fout ${res.status}`);
      toast(r.mailed ? 'Verzonden, en de klant is gemaild.' : r.mailEnabled === false ? 'Op verzonden gezet. (E-mails zijn nog niet ingesteld.)' : 'Op verzonden gezet.');
      viewOrder(id);
    } catch (err) {
      fail(err, 'Verzenden');
      btn.disabled = false;
    }
  });
}

// ---------- homepage en Over KNOOPZ: teksten en foto's ----------
type Slot = { key: string; label: string; hint: string; max: number; ratio: string; link?: boolean };
type TextField = { key: string; label: string; ph?: string; area?: boolean; single?: boolean };
type SiteSection = { heading: string; texts?: TextField[]; slots?: Slot[]; cols?: 2 | 3 };
type SitePageCfg = { route: string; title: string; note: string; sql: string; sections: SiteSection[]; messages?: boolean };

const HOME_CFG: SitePageCfg = {
  route: 'homepage',
  title: 'Homepage',
  note: "Pas hier de teksten en foto's van de homepage aan.",
  sql: '004_homepage_fotos.sql en 005_homepage_teksten.sql',
  sections: [
    {
      heading: 'Teksten',
      texts: [
        { key: 'hero_title', label: 'Grote titel bovenaan', ph: 'Statement pieces met vintage knopen' },
        { key: 'story_title', label: 'Kop bij het verhaal', ph: 'bijv. Elke knoop heeft een verhaal' },
        { key: 'story_text', label: 'Tekst bij het verhaal (2 à 3 zinnen)', area: true },
        { key: 'insta_title', label: 'Kop van het Instagram-blok', ph: 'bijv. Gespot met KNOOPZ' },
      ],
    },
    {
      heading: 'Campagnefoto',
      slots: [
        { key: 'hero_desktop', label: 'Grote foto bovenaan · computer', hint: 'Liggend, 3000 × 1688 px (16:9)', max: 2560, ratio: '16 / 9' },
        { key: 'hero_mobile', label: 'Grote foto bovenaan · telefoon', hint: 'Staand, 2000 × 2500 px (4:5). Leeg = de computerfoto wordt gebruikt', max: 1600, ratio: '4 / 5' },
      ],
    },
    { heading: 'Verhaal', slots: [{ key: 'story', label: 'Foto bij het verhaal', hint: 'Vierkant, bijv. 2000 × 2000 px (detail van een knoop)', max: 1600, ratio: '1 / 1' }] },
    {
      heading: 'Instagram-blok',
      cols: 3,
      slots: Array.from({ length: 6 }, (_, i) => ({ key: `insta_${i + 1}`, label: `Instagram-tegel ${i + 1}`, hint: 'Vierkant, bijv. 1080 × 1080 px', max: 800, ratio: '1 / 1', link: true })),
    },
  ],
};

const ABOUT_CFG: SitePageCfg = {
  route: 'over',
  title: 'Over KNOOPZ',
  note: 'Pas hier de tekst en foto\'s van de pagina Over KNOOPZ aan. Een blok zonder kop, tekst en foto wordt niet getoond. Laat een witregel tussen alinea\'s.',
  sql: '006_over_knoopz.sql',
  sections: [
    {
      heading: 'Bovenaan',
      texts: [
        { key: 'about_title', label: 'Titel', ph: 'Over KNOOPZ' },
        { key: 'about_intro', label: 'Inleiding (1 à 2 zinnen)', area: true },
      ],
      slots: [{ key: 'about_hero', label: 'Foto naast de titel', hint: 'Staand, 2000 × 2500 px (4:5). Optioneel', max: 1600, ratio: '4 / 5' }],
    },
    ...[1, 2, 3].map((n) => ({
      heading: `Blok ${n}`,
      texts: [
        { key: `about_${n}_title`, label: `Kop blok ${n}` },
        { key: `about_${n}_text`, label: `Tekst blok ${n}`, area: true },
      ],
      slots: [{ key: `about_${n}`, label: `Foto blok ${n}`, hint: 'Staand, 2000 × 2500 px (4:5)', max: 1600, ratio: '4 / 5' }],
    })),
  ],
};

const CONTACT_CFG: SitePageCfg = {
  route: 'contact',
  title: 'Contact',
  note: 'Berichten via het contactformulier verschijnen hieronder. Daaronder pas je de contactpagina aan.',
  sql: '007_contact.sql',
  messages: true,
  sections: [
    {
      heading: 'Contactpagina',
      texts: [
        { key: 'contact_title', label: 'Titel', ph: 'Contact' },
        { key: 'contact_intro', label: 'Korte tekst', ph: 'bijv. Vragen over een pet of je bestelling? We reageren binnen 2 werkdagen.', area: true },
        { key: 'contact_email', label: 'E-mailadres voor klanten', ph: 'bijv. info@knoopz.nl', single: true },
      ],
    },
    {
      heading: 'Bedrijfsgegevens',
      texts: [
        { key: 'contact_company', label: 'Bedrijfsnaam (zoals bij de KvK)', single: true },
        { key: 'contact_kvk', label: 'KvK-nummer', single: true },
        { key: 'contact_vat', label: 'Btw-nummer (optioneel)', single: true },
        { key: 'contact_address', label: 'Adres (optioneel)', area: true, single: true },
      ],
    },
  ],
};

const SHIP_CFG: SitePageCfg = {
  route: 'verzending',
  title: 'Verzending en retour',
  note: 'De verzendkosten worden automatisch getoond (in te stellen bij Instellingen). Een blok zonder kop en tekst wordt niet getoond. Laat een witregel tussen alinea\'s.',
  sql: '009_verzending_retour.sql',
  sections: [
    {
      heading: 'Bovenaan',
      texts: [
        { key: 'ship_title', label: 'Titel', ph: 'Verzending en retour' },
        { key: 'ship_intro', label: 'Inleiding (optioneel)', area: true },
      ],
    },
    ...[
      ['Verzending', 'bijv. Verzending en levertijd'],
      ['Retourneren', 'bijv. Retourneren binnen 14 dagen'],
      ['Ruilen / beschadigd', 'bijv. Beschadigd of verkeerd product?'],
      ['Overig', ''],
    ].map(([h, ph], i) => ({
      heading: `Blok ${i + 1}: ${h}`,
      texts: [
        { key: `ship_${i + 1}_title`, label: 'Kop', ph },
        { key: `ship_${i + 1}_text`, label: 'Tekst', area: true },
      ],
    })),
    {
      heading: 'Op de productpagina',
      texts: [
        { key: 'ship_short', label: 'Korte regel onder de knop In winkelwagen', ph: 'bijv. Verzonden binnen 2 werkdagen' },
        { key: 'ship_product', label: 'Tekst bij "Verzending en retour" (de kosten en een link naar deze pagina komen er automatisch bij)', area: true },
      ],
    },
  ],
};

const legalCfg = (route: string, prefix: string, title: string, ph: string): SitePageCfg => ({
  route,
  title,
  note: 'Pas hier de tekst van deze pagina aan.',
  sql: '009_verzending_retour.sql',
  sections: [
    {
      heading: title,
      texts: [
        { key: `${prefix}_title`, label: 'Titel', ph },
        { key: `${prefix}_updated`, label: 'Datum (bijv. "Laatst bijgewerkt: 1 november 2026")' },
        { key: `${prefix}_text`, label: 'Tekst', area: true },
      ],
    },
  ],
});
const PRIVACY_CFG = legalCfg('privacy', 'privacy', 'Privacyverklaring', 'Privacyverklaring');
const TERMS_CFG = legalCfg('voorwaarden', 'terms', 'Algemene voorwaarden', 'Algemene voorwaarden');

async function messagesHtml(): Promise<string> {
  const { data, error } = await sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const rows = data as any[];
  if (!rows.length) return '<h2>Berichten</h2><p class="a-note">Nog geen berichten.</p>';
  return `<h2>Berichten (${rows.filter((r) => !r.handled).length} open)</h2>
    <div class="a-msgs">${rows
      .map(
        (r) => `<div class="a-card a-msg${r.handled ? ' done' : ''}" data-msg="${esc(r.id)}">
        <div class="a-msg-head"><strong>${esc(r.name)}</strong> <a href="mailto:${esc(r.email)}">${esc(r.email)}</a> <span class="muted">${esc(dateTime(r.created_at))}</span></div>
        <p class="a-msg-body">${esc(r.message)}</p>
        <div class="a-buttons">
          <a class="btn btn-outline" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Re: je bericht aan KNOOPZ')}">Beantwoorden</a>
          <button type="button" class="a-link" data-toggle>${r.handled ? 'Markeer als open' : 'Markeer als afgehandeld'}</button>
          <button type="button" class="a-link" data-del>Verwijderen</button>
        </div>
      </div>`,
      )
      .join('')}</div>`;
}

async function viewSitePage(cfg: SitePageCfg) {
  app.innerHTML = '<p class="muted">Laden…</p>';
  const [imgs, texts] = await Promise.all([sb.from('site_images').select('*'), sb.from('site_texts').select('*')]);
  if (imgs.error || texts.error) {
    app.innerHTML = `<h1>${esc(cfg.title)}</h1><p class="a-error">Dit onderdeel is nog niet ingesteld in de database. Voer eerst het SQL-script <strong>${esc(cfg.sql)}</strong> uit in Supabase.</p>`;
    return;
  }
  const rows = new Map((imgs.data as any[]).map((r) => [r.key, r]));
  const tmap = new Map((texts.data as any[]).map((r) => [r.key, r]));

  let msgs = '';
  if (cfg.messages) {
    try {
      msgs = await messagesHtml();
    } catch {
      app.innerHTML = `<h1>${esc(cfg.title)}</h1><p class="a-error">Dit onderdeel is nog niet ingesteld in de database. Voer eerst het SQL-script <strong>${esc(cfg.sql)}</strong> uit in Supabase.</p>`;
      return;
    }
  }
  const field = (f: TextField, lang: 'nl' | 'en') => {
    const v = esc(tmap.get(f.key)?.[lang]);
    const ph = esc(lang === 'nl' ? f.ph ?? '' : '');
    return `<label class="a-field"><span>${esc(f.label)}${f.single ? '' : ` (${lang.toUpperCase()})`}</span>${
      f.area ? `<textarea name="${f.key}_${lang}" placeholder="${ph}">${v}</textarea>` : `<input name="${f.key}_${lang}" value="${v}" placeholder="${ph}" />`
    }</label>`;
  };
  const slot = (s: Slot) => {
    const r = rows.get(s.key);
    return `
      <div class="a-card a-slot" data-key="${s.key}">
        <div class="a-slot-img" style="aspect-ratio:${s.ratio}">${r ? `<img src="${esc(publicImageUrl(r.path))}" alt="" />` : '<span>Nog geen foto</span>'}</div>
        <div class="a-slot-info">
          <strong>${esc(s.label)}</strong>
          <small class="muted">${esc(s.hint)}</small>
          <div class="a-buttons">
            <label class="btn btn-outline" style="cursor:pointer">${r ? 'Vervangen' : 'Foto kiezen'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-file /></label>
            ${r ? '<button type="button" class="a-link" data-remove>Verwijderen</button>' : ''}
          </div>
          ${
            r
              ? `<label class="a-field"><span>Beschrijving (NL)</span><input data-f="alt_nl" value="${esc(r.alt_nl)}" placeholder="Wat staat er op de foto?" /></label>
          <label class="a-field"><span>Beschrijving (EN)</span><input data-f="alt_en" value="${esc(r.alt_en)}" /></label>
          ${s.link ? `<label class="a-field"><span>Link (optioneel)</span><input data-f="link" type="url" value="${esc(r.link)}" placeholder="Link naar de Instagram-post; leeg = @knoopz.wear" /></label>` : ''}`
              : ''
          }
          <p class="a-note" data-progress></p>
        </div>
      </div>`;
  };
  const allTexts = cfg.sections.flatMap((s) => s.texts ?? []);
  const allSlots = cfg.sections.flatMap((s) => s.slots ?? []);

  app.innerHTML = `
    <h1>${esc(cfg.title)}</h1>
    <p class="a-note">${esc(cfg.note)} ${FORMAT_HELP} ${allSlots.length ? "Foto's worden automatisch verkleind. " : ''}Klik daarna op <strong>Wijzigingen publiceren</strong>.</p>
    ${msgs}
    <form data-texts novalidate>
      ${cfg.sections
        .map(
          (s) => `<h2>${esc(s.heading)}</h2>
        ${s.texts?.length ? `<div class="a-form a-card">${s.texts.map((f) => `<div class="a-row">${field(f, 'nl')}${f.single ? '' : field(f, 'en')}</div>`).join('')}</div>` : ''}
        ${s.slots?.length ? `<div class="a-slots ${s.cols === 3 ? 'a-slots-3' : 'a-slots-2'}" style="margin-top:16px">${s.slots.map(slot).join('')}</div>` : ''}`,
        )
        .join('')}
      ${allTexts.length ? `<div class="a-savebar"><span class="a-note">Leeg = standaardtekst. Engels leeg = de Nederlandse tekst wordt gebruikt.</span><button class="btn btn-dark" type="submit">Teksten opslaan</button></div>` : ''}
    </form>`;

  const tform = app.querySelector<HTMLFormElement>('[data-texts]')!;
  tform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rowsT = allTexts.map((x) => ({ key: x.key, nl: orNull(val(tform, `${x.key}_nl`)), en: x.single ? null : orNull(val(tform, `${x.key}_en`)) }));
    const { error } = await sb.from('site_texts').upsert(rowsT);
    if (error) return fail(error, 'Teksten opslaan');
    setDirty(true);
    toast('Teksten opgeslagen. Klik op Wijzigingen publiceren om ze op de site te zetten.');
  });

  app.querySelectorAll<HTMLElement>('[data-msg]').forEach((card) => {
    const id = card.dataset.msg!;
    card.querySelector('[data-toggle]')!.addEventListener('click', async () => {
      const { error } = await sb.from('contact_messages').update({ handled: !card.classList.contains('done') }).eq('id', id);
      if (error) return fail(error, 'Opslaan');
      viewSitePage(cfg);
    });
    card.querySelector('[data-del]')!.addEventListener('click', async () => {
      if (!confirm('Dit bericht verwijderen?')) return;
      const { error } = await sb.from('contact_messages').delete().eq('id', id);
      if (error) return fail(error, 'Verwijderen');
      viewSitePage(cfg);
    });
  });

  app.querySelectorAll<HTMLElement>('.a-slot').forEach((card) => {
    const key = card.dataset.key!;
    const s = allSlots.find((x) => x.key === key)!;
    const r = rows.get(key);
    const progress = card.querySelector<HTMLElement>('[data-progress]')!;
    card.querySelector<HTMLInputElement>('[data-file]')!.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      progress.textContent = 'Bezig met uploaden…';
      try {
        const blob = await resizeImage(f, s.max, 0.86);
        const path = `site/${key}-${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (up.error) throw up.error;
        const { error } = await sb.from('site_images').upsert({ key, path, alt_nl: r?.alt_nl ?? null, alt_en: r?.alt_en ?? null, link: r?.link ?? null });
        if (error) throw error;
        if (r?.path) await sb.storage.from(IMAGE_BUCKET).remove([r.path]);
        setDirty(true);
        toast('Foto opgeslagen.');
        viewSitePage(cfg);
      } catch (err) {
        progress.textContent = '';
        fail(err, 'Uploaden');
      }
    });
    card.querySelector('[data-remove]')?.addEventListener('click', async () => {
      if (!confirm('Deze foto verwijderen?')) return;
      const { error } = await sb.from('site_images').delete().eq('key', key);
      if (error) return fail(error, 'Verwijderen');
      await sb.storage.from(IMAGE_BUCKET).remove([r.path]);
      setDirty(true);
      viewSitePage(cfg);
    });
    card.querySelectorAll<HTMLInputElement>('[data-f]').forEach((input) =>
      input.addEventListener('change', async () => {
        const { error } = await sb.from('site_images').update({ [input.dataset.f!]: orNull(input.value.trim()) }).eq('key', key);
        if (error) return fail(error, 'Opslaan');
        setDirty(true);
        toast('Opgeslagen.');
      }),
    );
  });
}

// ---------- FAQ ----------
async function viewFaq() {
  app.innerHTML = '<p class="muted">Laden…</p>';
  const { data, error } = await sb.from('faq_items').select('*').order('sort').order('created_at');
  if (error) {
    app.innerHTML = '<h1>FAQ</h1><p class="a-error">Dit onderdeel is nog niet ingesteld in de database. Voer eerst het SQL-script <strong>008_faq.sql</strong> uit in Supabase.</p>';
    return;
  }
  const items = data as any[];
  const form = (it: any | null, i: number) => `
    <form class="a-form a-card a-faq" data-faq="${esc(it?.id ?? '')}" novalidate>
      ${
        it
          ? `<div class="a-faq-head"><strong>Vraag ${i + 1}</strong>${it.published ? '' : ' <span class="a-pill hidden">Verborgen</span>'}
        <span class="a-image-actions"><button type="button" class="a-icon" data-move="-1" aria-label="Omhoog" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="a-icon" data-move="1" aria-label="Omlaag" ${i === items.length - 1 ? 'disabled' : ''}>↓</button></span></div>`
          : ''
      }
      <div class="a-row">
        <label class="a-field"><span>Vraag (NL) *</span><input name="question_nl" value="${esc(it?.question_nl)}" required /></label>
        <label class="a-field"><span>Vraag (EN)</span><input name="question_en" value="${esc(it?.question_en)}" /></label>
      </div>
      <div class="a-row">
        <label class="a-field"><span>Antwoord (NL) *</span><textarea name="answer_nl" required>${esc(it?.answer_nl)}</textarea></label>
        <label class="a-field"><span>Antwoord (EN)</span><textarea name="answer_en">${esc(it?.answer_en)}</textarea></label>
      </div>
      <label class="a-check"><input type="checkbox" name="published" ${it?.published !== false ? 'checked' : ''} /> Zichtbaar op de website</label>
      <div class="a-buttons">
        <button class="btn btn-dark" type="submit">${it ? 'Opslaan' : 'Vraag toevoegen'}</button>
        ${it ? '<button class="btn btn-danger" type="button" data-del>Verwijderen</button>' : ''}
      </div>
    </form>`;

  app.innerHTML = `
    <h1>FAQ</h1>
    <p class="a-note">Veelgestelde vragen voor de pagina FAQ. ${FORMAT_HELP} Engels leeg = de Nederlandse tekst wordt gebruikt. Klik na het aanpassen op <strong>Wijzigingen publiceren</strong>.</p>
    ${items.length ? items.map((it, i) => form(it, i)).join('') : '<p class="a-note">Nog geen vragen.</p>'}
    <h2>Nieuwe vraag</h2>
    ${form(null, items.length)}`;

  app.querySelectorAll<HTMLFormElement>('[data-faq]').forEach((f) => {
    const id = f.dataset.faq;
    const idx = items.findIndex((x) => x.id === id);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = val(f, 'question_nl');
      const a = val(f, 'answer_nl');
      if (!q || !a) return toast('Vraag en antwoord (NL) zijn verplicht.', true);
      const row = { question_nl: q, answer_nl: a, question_en: orNull(val(f, 'question_en')), answer_en: orNull(val(f, 'answer_en')), published: checked(f, 'published') };
      const { error } = id
        ? await sb.from('faq_items').update(row).eq('id', id)
        : await sb.from('faq_items').insert({ ...row, sort: items.reduce((m, x) => Math.max(m, x.sort), 0) + 1 });
      if (error) return fail(error, 'Opslaan');
      setDirty(true);
      toast(id ? 'Opgeslagen.' : 'Vraag toegevoegd.');
      viewFaq();
    });
    f.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Deze vraag verwijderen?')) return;
      const { error } = await sb.from('faq_items').delete().eq('id', id!);
      if (error) return fail(error, 'Verwijderen');
      setDirty(true);
      viewFaq();
    });
    f.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
      b.addEventListener('click', async () => {
        const order = [...items];
        const j = idx + Number(b.dataset.move);
        if (j < 0 || j >= order.length) return;
        [order[idx], order[j]] = [order[j], order[idx]];
        const results = await Promise.all(order.map((x, n) => sb.from('faq_items').update({ sort: n + 1 }).eq('id', x.id)));
        const err = results.find((r) => r.error)?.error;
        if (err) return fail(err, 'Volgorde aanpassen');
        setDirty(true);
        viewFaq();
      }),
    );
  });
}

// ---------- kortingscodes ----------
async function viewCodes() {
  app.innerHTML = '<p class="muted">Laden…</p>';
  const { data, error } = await sb.from('discount_codes').select('*').order('created_at', { ascending: false });
  if (error) return fail(error, 'Kortingscodes laden');
  const rows = data as any[];
  const amount = (r: any) => (r.kind === 'percent' ? `${r.value}%` : euro(r.value));
  const dateOnly = (iso: string | null) => (iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—');

  app.innerHTML = `
    <h1>Kortingscodes</h1>
    <div class="a-scroll"><table class="a-table">
      <thead><tr><th>Code</th><th>Korting</th><th>Gebruikt</th><th class="hide-sm">Geldig t/m</th><th>Status</th><th></th></tr></thead>
      <tbody>${
        rows.length
          ? rows
              .map(
                (r) => `<tr data-id="${esc(r.id)}">
        <td><strong>${esc(r.code)}</strong>${r.note ? `<br><small class="muted">${esc(r.note)}</small>` : ''}</td>
        <td>${esc(amount(r))}${r.min_order_cents ? `<br><small class="muted">vanaf ${esc(euro(r.min_order_cents))}</small>` : ''}</td>
        <td>${r.used_count}${r.max_uses ? ` / ${r.max_uses}` : ''}</td>
        <td class="hide-sm">${esc(dateOnly(r.ends_at))}</td>
        <td>${r.active ? '<span class="a-pill">Actief</span>' : '<span class="a-pill hidden">Uit</span>'}</td>
        <td class="a-cell-actions"><button class="a-link" data-toggle>${r.active ? 'Uitzetten' : 'Aanzetten'}</button>${r.used_count === 0 ? ' <button class="a-link" data-del>Verwijderen</button>' : ''}</td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="6" class="muted">Nog geen kortingscodes.</td></tr>'
      }</tbody>
    </table></div>
    <h2>Nieuwe kortingscode</h2>
    <form class="a-form a-card" data-new novalidate>
      <div class="a-row">
        <label class="a-field"><span>Code *</span><input name="code" required placeholder="bijv. LAUNCH10" autocapitalize="characters" /><small>Hoofdletters, cijfers, - of _ (3 tot 30 tekens)</small></label>
        <label class="a-field"><span>Omschrijving (alleen voor jullie)</span><input name="note" placeholder="bijv. vrienden en familie" /></label>
      </div>
      <div class="a-row a-row-3">
        <label class="a-field"><span>Soort</span><select name="kind"><option value="percent">Percentage (%)</option><option value="amount">Vast bedrag (€)</option></select></label>
        <label class="a-field"><span>Waarde *</span><input name="value" inputmode="decimal" required placeholder="bijv. 10" /></label>
        <label class="a-field"><span>Minimaal bestelbedrag (€)</span><input name="min" inputmode="decimal" placeholder="leeg = geen minimum" /></label>
      </div>
      <div class="a-row">
        <label class="a-field"><span>Maximaal aantal keer te gebruiken</span><input name="max" type="number" min="1" placeholder="leeg = onbeperkt" /><small>Totaal over alle klanten</small></label>
        <label class="a-field"><span>Geldig tot en met</span><input name="ends" type="date" /><small>Leeg = geen einddatum</small></label>
      </div>
      <p class="a-error" data-err hidden></p>
      <div class="a-buttons"><button class="btn btn-dark" type="submit">Kortingscode aanmaken</button></div>
    </form>
    <p class="a-note">Kortingscodes werken direct, je hoeft niet te publiceren.</p>`;

  app.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
    const r = rows.find((x) => x.id === tr.dataset.id);
    tr.querySelector('[data-toggle]')?.addEventListener('click', async () => {
      const { error } = await sb.from('discount_codes').update({ active: !r.active }).eq('id', r.id);
      if (error) return fail(error, 'Opslaan');
      viewCodes();
    });
    tr.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm(`Kortingscode ${r.code} verwijderen?`)) return;
      const { error } = await sb.from('discount_codes').delete().eq('id', r.id);
      if (error) return fail(error, 'Verwijderen');
      viewCodes();
    });
  });

  const form = app.querySelector<HTMLFormElement>('[data-new]')!;
  const err = form.querySelector<HTMLElement>('[data-err]')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const code = val(form, 'code').toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new Error('Gebruik 3 tot 30 hoofdletters, cijfers, - of _.');
      const kind = val(form, 'kind') === 'amount' ? 'amount' : 'percent';
      let value: number;
      if (kind === 'percent') {
        value = parseInt(val(form, 'value'), 10);
        if (!(value >= 1 && value <= 100)) throw new Error('Kies een percentage tussen 1 en 100.');
      } else {
        value = parseEuro(val(form, 'value')) ?? 0;
        if (value <= 0) throw new Error('Vul een bedrag in.');
      }
      const max = parseInt(val(form, 'max'), 10);
      const ends = val(form, 'ends');
      const { error } = await sb.from('discount_codes').insert({
        code,
        kind,
        value,
        note: orNull(val(form, 'note')),
        min_order_cents: parseEuro(val(form, 'min')),
        max_uses: max > 0 ? max : null,
        ends_at: ends ? new Date(`${ends}T23:59:59`).toISOString() : null,
      });
      if (error) throw error.code === '23505' ? new Error('Deze code bestaat al.') : error;
      toast(`Kortingscode ${code} aangemaakt.`);
      viewCodes();
    } catch (e: any) {
      err.textContent = `Aanmaken mislukt: ${e?.message || e}`;
      err.hidden = false;
    }
  });
}

// ---------- start ----------
route();
