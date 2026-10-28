// Eenvoudige opmaak in teksten uit het beheer: **woord** wordt dikgedrukt.
// De tekst wordt eerst veilig gemaakt (geen HTML van buitenaf), daarna wordt alleen **...** omgezet.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const rich = (s: string | null | undefined): string => esc(s ?? '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

// Opmaak voor langere teksten, overal op de site hetzelfde:
//   **woord**   dikgedrukt
//   ## Kop      tussenkop (aan het begin van een regel)
//   - punt      opsomming met knoopjes (ook "* " of "• ")
//   1. punt     genummerde lijst (nummert vanzelf)
//   witregel    nieuwe alinea; een gewone enter blijft een nieuwe regel
// Geeft blokken terug die de pagina zelf rendert: <Tag class={cls} set:html={html} />,
// zodat de stijlen van die pagina (bijv. ".ab-text p") gewoon blijven werken.
export type Block = { Tag: 'p' | 'h2' | 'ul' | 'ol'; cls?: string; html: string };

const LIST = /^([-•*]|\d+[.)])\s+/;

export const textBlocks = (s: string | null | undefined, pClass?: string): Block[] => {
  const out: Block[] = [];
  for (const chunk of (s ?? '').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    let para: string[] = [];
    let list: string[] = [];
    let listType: 'ul' | 'ol' = 'ul';
    const flush = () => {
      if (para.length) out.push({ Tag: 'p', cls: pClass, html: para.map(rich).join('<br>') });
      if (list.length) out.push({ Tag: listType, cls: 'knoop-list', html: list.map((i) => `<li>${rich(i)}</li>`).join('') });
      para = [];
      list = [];
    };
    for (const l of lines) {
      if (l.startsWith('## ')) {
        flush();
        out.push({ Tag: 'h2', cls: 'h3 rt-h', html: rich(l.slice(3).trim()) });
      } else if (LIST.test(l)) {
        const type = /^\d/.test(l) ? 'ol' : 'ul';
        if (para.length || (list.length && type !== listType)) flush();
        listType = type;
        list.push(l.replace(LIST, ''));
      } else {
        if (list.length) flush();
        para.push(l);
      }
    }
    flush();
  }
  return out;
};
