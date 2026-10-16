/** Test-only server rendering of the real React hooks, without DOM globals. */
declare module 'react-dom/server' {
  export function renderToString(element: import('react').ReactNode): string;
}
