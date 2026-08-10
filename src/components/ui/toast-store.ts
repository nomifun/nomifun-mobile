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

function push(kind: ToastKind, text: string) {
  const id = nextId++;
  items = [...items.slice(-2), { id, kind, text }];
  emit();
  setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 2600);
}

export const toastStore = {
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
