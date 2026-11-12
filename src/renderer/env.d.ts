import type { DeskMateApi } from '../shared/types';

declare global {
  interface Window {
    deskmate: DeskMateApi;
  }
}

export {};
