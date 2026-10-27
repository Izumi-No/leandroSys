import type { LeandroApi } from '../src/preload-api';

declare global {
  interface Window {
    leandro: LeandroApi;
  }
}

export {};
