// /drops/<slug>/ — gebouwde drops komen gewoon van de site.
// Bestaat de pagina niet (drop is nog niet publiek), dan tonen we de early access-pagina.
// Die vraagt met de code uit de link (?toegang=...) bij de server op of de drop bekeken mag worden.
import { earlyAccessPage } from '../../server/early-access-page';

export const onRequestGet = earlyAccessPage('nl');
