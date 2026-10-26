import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  const privateSeed = r('./seed/private/seed.json');
  const seed = (artifact || mode === 'demo') && existsSync(privateSeed) ? privateSeed : r('./seed/sample.json');
  return {
    plugins: [react(), ...(artifact ? [viteSingleFile()] : [])],
    resolve: {
      alias: {
        '@seed': seed,
        '@font': r(artifact ? './src/font-single.css' : './src/font-subset.css'),
      },
    },
    define: {
      __FORCE_DEMO__: JSON.stringify(artifact || mode === 'demo'),
    },
    build: {
      outDir: artifact ? 'dist-artifact' : 'dist',
      assetsInlineLimit: artifact ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 2000,
    },
  };
});
