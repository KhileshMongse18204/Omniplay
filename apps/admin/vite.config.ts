import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Same build rules as the public site: minified JS/CSS/HTML, one chunk per lazy page.
const minifyHtml = (): Plugin => ({
  name: 'omniplay:minify-html',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml: (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim(),
});

export default defineConfig({
  plugins: [react(), tailwindcss(), minifyHtml()],
  build: { target: 'es2022', modulePreload: { polyfill: false }, sourcemap: false },
  server: { port: 5174 },
});
