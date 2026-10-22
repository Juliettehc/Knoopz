// Eenvoudige opmaak in teksten uit het beheer: **woord** wordt dikgedrukt.
// De tekst wordt eerst veilig gemaakt (geen HTML van buitenaf), daarna wordt alleen **...** omgezet.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const rich = (s: string | null | undefined): string => esc(s ?? '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
