// /en/drops/<slug>/ — zie functions/drops/[[path]].ts
import { earlyAccessPage } from '../../../server/early-access-page';

export const onRequestGet = earlyAccessPage('en');
