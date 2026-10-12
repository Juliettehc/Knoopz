import { defineConfig } from 'astro/config';

export default defineConfig({
  i18n: {
    defaultLocale: 'nl',
    locales: ['nl', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
