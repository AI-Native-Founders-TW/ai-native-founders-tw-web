// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// 網域尚未定案（A11）；以環境變數覆寫
const site = process.env.SITE_URL ?? 'https://ai-native-founders-tw.pages.dev';

export default defineConfig({
  site,
  integrations: [react()],
  i18n: {
    defaultLocale: 'zh-tw',
    locales: ['zh-tw', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  vite: { plugins: [tailwindcss()] },
});
