import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vite minifies JS (Oxc) and CSS (Lightning CSS) and gives every lazy() import its own chunk.
// It leaves index.html untouched, so this plugin strips comments and whitespace from it.
const minifyHtml = (): Plugin => ({
  name: 'omniplay:minify-html',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml: (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim(),
});

export default defineConfig({
  plugins: [react(), tailwindcss(), minifyHtml()],
  build: {
    target: 'es2022', // modern browsers only: no legacy transforms, smaller output
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: { port: 5173 },
});
