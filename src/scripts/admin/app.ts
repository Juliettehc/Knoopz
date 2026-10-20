// KNOOPZ beheer: inloggen, producten, foto's, drops, bestellingen, kortingscodes, instellingen en publiceren.
// Werkt rechtstreeks met Supabase. Wat wel en niet mag, bepaalt de database (Row Level Security).

import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, IMAGE_BUCKET, publicImageUrl } from '../../lib/supabase-config';
import { resizeImage } from './images';

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
    const navKey = section === 'product' ? 'producten' : section === 'bestelling' ? 'bestellingen' : section;
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
  });

  if (section === 'product') return viewProduct(id === 'nieuw' ? null : id);
  if (section === 'drops') return viewDrops();
  if (section === 'bestellingen') return viewOrders();
  if (section === 'bestelling' && id) return viewOrder(id);
  if (section === 'kortingscodes') return viewCodes();
  if (section === 'instellingen') return viewSettings();
  return viewProducts();
}

window.addEventListener('hashchange', route);

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
type Drop = { id: string; slug: string; name_nl: string; name_en: string | null; intro_nl: string | null; intro_en: string | null; sort: number; published: boolean };

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
  const area = (name: string, label: string) => `<label class="a-field"><span>${label}</span><textarea name="${name}">${esc(p?.[name])}</textarea></label>`;

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
      const { error } = isNew
        ? await sb.from('products').insert({ id: productId, ...row })
        : await sb.from('products').update(row).eq('id', productId);
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
        <label class="a-field"><span>Introtekst (NL)</span><textarea name="intro_nl">${esc(d?.intro_nl)}</textarea></label>
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

  app.innerHTML = `
    <h1>Drops</h1>
    ${drops.map((d) => `<h2>${esc(d.name_nl)}</h2>${form(d)}`).join('')}
    <h2>Nieuwe drop</h2>
    ${form(null)}`;

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
  const { data, error } = await sb.from('settings').select('*').eq('id', 1).single();
  if (error) return fail(error, 'Instellingen laden');
  app.innerHTML = `
    <h1>Instellingen</h1>
    <h2>Verzending</h2>
    <form class="a-form a-card" data-ship novalidate>
      <div class="a-row">
        <label class="a-field"><span>Verzendkosten Nederland (€)</span><input name="ship" inputmode="decimal" placeholder="bijv. 4,95" value="${esc(centsToInput(data.shipping_cents))}" /></label>
        <label class="a-field"><span>Verzendkosten België (€)</span><input name="ship_be" inputmode="decimal" placeholder="leeg = zelfde als Nederland" value="${esc(centsToInput(data.shipping_be_cents))}" /></label>
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
  bindPasswordForm(app.querySelector<HTMLFormElement>('[data-pw]')!, () => {});
}

// ---------- bestellingen ----------
const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Betaald · te verzenden', cls: 'todo' },
  shipped: { label: 'Verzonden', cls: '' },
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
    .select('id,number,status,first_name,last_name,email,total_cents,created_at,paid_at,needs_attention,country')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return fail(error, 'Bestellingen laden');
  const rows = data as any[];
  const counts = { todo: rows.filter((r) => r.status === 'paid').length };

  app.innerHTML = `
    <h1>Bestellingen</h1>
    <div class="a-toolbar">
      <input class="a-search" type="search" placeholder="Zoek op nummer, naam of e-mail" aria-label="Zoek bestellingen" data-q />
      <div class="a-filters" role="group" aria-label="Filter">
        <button class="filter" aria-pressed="true" data-f="todo">Te verzenden (${counts.todo})</button>
        <button class="filter" aria-pressed="false" data-f="shipped">Verzonden</button>
        <button class="filter" aria-pressed="false" data-f="paidall">Alle betaalde</button>
        <button class="filter" aria-pressed="false" data-f="open">Niet betaald</button>
      </div>
    </div>
    <p class="a-note" data-count></p>
    <div class="a-scroll">
      <table class="a-table">
        <thead><tr><th>Nummer</th><th class="hide-sm">Datum</th><th>Klant</th><th>Totaal</th><th>Status</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>
    <p class="a-note">Niet-betaalde bestellingen zijn klanten die zijn gaan afrekenen maar (nog) niet betaald hebben. Die stukken zijn na 15 minuten automatisch weer te koop.</p>`;

  const tbody = app.querySelector<HTMLElement>('[data-rows]')!;
  const q = app.querySelector<HTMLInputElement>('[data-q]')!;
  let filter = 'todo';
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (term && !`${r.number} ${r.first_name} ${r.last_name} ${r.email}`.toLowerCase().includes(term)) return false;
      if (filter === 'todo') return r.status === 'paid';
      if (filter === 'shipped') return r.status === 'shipped';
      if (filter === 'paidall') return r.status === 'paid' || r.status === 'shipped';
      return !['paid', 'shipped'].includes(r.status);
    });
    app.querySelector('[data-count]')!.textContent = `${list.length} bestelling${list.length === 1 ? '' : 'en'}`;
    tbody.innerHTML = list.length
      ? list
          .map(
            (r) => `<tr>
          <td><a href="#/bestelling/${esc(r.id)}">${esc(r.number)}</a>${r.needs_attention ? ' <span class="a-pill sold" title="Actie nodig">!</span>' : ''}</td>
          <td class="hide-sm">${esc(dateTime(r.paid_at ?? r.created_at))}</td>
          <td>${esc(r.first_name)} ${esc(r.last_name)}</td>
          <td>${esc(euro(r.total_cents))}</td>
          <td>${statusPill(r.status)}</td>
        </tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="muted">Geen bestellingen.</td></tr>';
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

async function viewOrder(id: string) {
  app.innerHTML = '<p class="muted">Laden…</p>';
  const { data: o, error } = await sb.from('orders').select('*,order_items(*)').eq('id', id).single();
  if (error) return fail(error, 'Bestelling laden');
  const countries: Record<string, string> = { NL: 'Nederland', BE: 'België' };
  const addressText = `${o.first_name} ${o.last_name}\n${o.street}\n${o.postal_code} ${o.city}\n${countries[o.country] ?? o.country}`;
  const canShip = o.status === 'paid' || o.status === 'shipped';

  app.innerHTML = `
    <p><a href="#/bestellingen">← Terug naar bestellingen</a></p>
    <h1>${esc(o.number)} ${statusPill(o.status)}</h1>
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
      canShip
        ? `<h2>Verzending</h2>
    <form class="a-form a-card" data-ship novalidate>
      <label class="a-field"><span>Track &amp; trace-link (optioneel)</span><input name="tracking" type="url" placeholder="https://..." value="${esc(o.tracking_url)}" /></label>
      <label class="a-check"><input type="checkbox" name="notify" checked /> Stuur de klant een e-mail dat het pakket onderweg is</label>
      <div class="a-buttons"><button class="btn btn-dark" type="submit">${o.status === 'shipped' ? 'Verzendgegevens bijwerken' : 'Markeer als verzonden'}</button></div>
    </form>`
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
