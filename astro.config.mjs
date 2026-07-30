// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.impostor.pm',

  // Softr serves and Google has indexed every URL WITHOUT a trailing slash
  // (/club/hamburg, /compensation, ...). `format: 'file'` emits huddle.html
  // rather than huddle/index.html, so Cloudflare Pages serves /huddle
  // directly instead of 308-ing it to /huddle/. Changing either of these
  // silently 308s every indexed URL on cutover day.
  trailingSlash: 'never',
  build: { format: 'file' },
});
