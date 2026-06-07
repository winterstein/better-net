/** Bundled prompt text (esbuild text loader). */
declare module '*.txt' {
  const content: string;
  export default content;
}

/** Options page loads defaults via classic script before options.ts. */
interface Window {
  BN_SETTINGS?: {
    DEFAULTS: Record<string, unknown>;
    NAV_PAGES: { id: string; label: string }[];
    MODULES: { id: string; name: string; description: string }[];
    mergeSettings: (stored: Record<string, unknown>) => Record<string, unknown>;
    normalizeDomain: (input: string) => string;
  };
}

/** Migrated DOM code often treats elements as form controls. */
interface HTMLElement {
  value?: string;
  checked?: boolean;
  options?: HTMLOptionsCollection;
}

interface Element {
  value?: string;
  checked?: boolean;
  style?: CSSStyleDeclaration;
  dataset?: DOMStringMap;
  href?: string;
  content?: string;
}

interface EventTarget {
  checked?: boolean;
  style?: CSSStyleDeclaration;
  closest?(selector: string): Element | null;
}
