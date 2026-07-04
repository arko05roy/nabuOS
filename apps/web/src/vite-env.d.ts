/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PULSE_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
