/// <reference types="vite/client" />
declare const __FORCE_DEMO__: boolean;
declare module '@seed' {
  import type { Seed } from './lib/types';
  const seed: Seed;
  export default seed;
}
