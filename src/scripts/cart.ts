// Winkelwagen in de browser (fase 3).
// Unieke producten: elk product kan maar één keer in de winkelwagen.
// De echte voorraadcontrole en reservering gebeuren in fase 5 op de server.

const KEY = 'knoopz-cart';
const EVENT = 'knoopz:cart-change';

export const getCart = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const save = (ids: string[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* opslag niet beschikbaar: winkelwagen werkt dan alleen op deze pagina */
  }
  document.dispatchEvent(new CustomEvent(EVENT));
};

export const inCart = (id: string) => getCart().includes(id);

export const addToCart = (id: string) => {
  const ids = getCart();
  if (!ids.includes(id)) save([...ids, id]);
};

export const removeFromCart = (id: string) => save(getCart().filter((x) => x !== id));

export const removeManyFromCart = (ids: string[]) => save(getCart().filter((x) => !ids.includes(x)));

export const clearCart = () => save([]);

export const onCartChange = (fn: () => void) => {
  document.addEventListener(EVENT, fn);
  window.addEventListener('storage', (e) => e.key === KEY && fn());
};
