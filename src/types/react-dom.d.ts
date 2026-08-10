/**
 * Minimal ambient declaration for the one `react-dom` API the web toast host
 * uses. `@types/react-dom` is not installed (the app is React Native first) and
 * adding it would pull a second React typings graph.
 */
declare module 'react-dom' {
  import type { ReactNode } from 'react';
  export function createPortal(children: ReactNode, container: Element): ReactNode;
}
