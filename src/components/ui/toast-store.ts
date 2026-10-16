/**
 * Toast store — platform-agnostic. The host that renders these lives in
 * `toast.tsx` (native) / `toast.web.tsx` (web, portalled above modals).
 */
export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];
let nextId = 1;

function emit() {
  const snapshot = items;
  for (const listener of Array.from(listeners)) listener(snapshot);
}

function dismiss(id: number) {
  if (!items.some((item) => item.id === id)) return;
  items = items.filter((item) => item.id !== id);
  emit();
}

function push(kind: ToastKind, text: string) {
  const id = nextId++;
  items = [...items.slice(-2), { id, kind, text }];
  emit();
  setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000);
}

export const toastStore = {
  dismiss,
  subscribe(listener: (items: ToastItem[]) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot(): ToastItem[] {
    return items;
  },
};

export const toast = {
  success: (text: string) => push('success', text),
  error: (text: string) => push('error', text),
  info: (text: string) => push('info', text),
};
