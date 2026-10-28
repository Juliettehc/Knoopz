import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://knoopz.nl',
  i18n: {
    defaultLocale: 'nl',
    locales: ['nl', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
