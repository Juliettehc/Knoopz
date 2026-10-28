// Eenvoudige opmaak in teksten uit het beheer: **woord** wordt dikgedrukt.
// De tekst wordt eerst veilig gemaakt (geen HTML van buitenaf), daarna wordt alleen **...** omgezet.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const rich = (s: string | null | undefined): string => esc(s ?? '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

// Zoals rich, maar regels die beginnen met "- " (of "* ", "• ") worden een opsomming met knoopjes
// en "1. " een genummerde lijst. Gewone regels blijven regels (de container gebruikt white-space: pre-line).
export const richText = (s: string | null | undefined): string => {
  const out: string[] = [];
  let list: string[] = [];
  let listType: 'ul' | 'ol' = 'ul';
  const flush = () => {
    if (list.length) out.push(`<${listType} class="knoop-list">${list.map((i) => `<li>${rich(i)}</li>`).join('')}</${listType}>`);
    list = [];
  };
  for (const line of (s ?? '').split('\n')) {
    const l = line.trim();
    if (/^[-•*] /.test(l) || /^\d+[.)] /.test(l)) {
      const type = /^\d/.test(l) ? 'ol' : 'ul';
      if (list.length && type !== listType) flush();
      listType = type;
      list.push(l.replace(/^([-•*]|\d+[.)]) /, '').trim());
    } else {
      flush();
      out.push(rich(line));
    }
  }
  flush();
  // Geen losse regeleinden rond een lijst, anders geeft pre-line extra witruimte
  return out.join('\n').replace(/\n*(<\/?[uo]l class="knoop-list">|<\/[uo]l>)\n*/g, '$1');
};
