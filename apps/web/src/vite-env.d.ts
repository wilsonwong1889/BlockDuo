/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  /** AdSense publisher ID, `ca-pub-` and sixteen digits. Unset means no adverts. */
  readonly VITE_ADSENSE_CLIENT?: string;
  /** Slot ID for the home screen unit, from the AdSense dashboard. */
  readonly VITE_ADSENSE_SLOT_HOME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
