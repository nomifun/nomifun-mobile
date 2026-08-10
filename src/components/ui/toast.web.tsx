import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { ToastPill, styles } from './toast-pill';
import { toast, toastStore } from './toast-store';

export { toast };

/**
 * Web toast host.
 *
 * react-native-web renders `Modal` into its own portal at `z-index: 9999`, and
 * the app-root toast container sits inside an ancestor stacking context — so a
 * toast fired while any modal is open was completely hidden (verified: raising
 * z-index alone does nothing, escaping to a body-level portal is required).
 * That silently swallowed error toasts too, e.g. a failed save inside the model
 * picker or the workspace panel.
 */
export function ToastHost() {
  const { colors } = useTheme();
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.snapshot, toastStore.snapshot);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const node = document.createElement('div');
    node.setAttribute('data-nomifun-toast-host', '');
    // Above RNW's Modal portal (9999); never intercepts pointer events.
    node.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:10000;pointer-events:none;display:flex;justify-content:center;';
    document.body.appendChild(node);
    nodeRef.current = node;
    setContainer(node);
    return () => {
      node.remove();
      nodeRef.current = null;
    };
  }, []);

  if (!container || items.length === 0) return null;

  return createPortal(
    <View pointerEvents="none" style={[styles.host, { top: 16 }]}>
      {items.map((item) => (
        <ToastPill key={item.id} item={item} colors={colors} />
      ))}
    </View>,
    container,
  );
}
