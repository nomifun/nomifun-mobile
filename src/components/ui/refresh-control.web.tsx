import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { IconButton } from './icon-button';

/**
 * Web replacement for react-native-web's RefreshControl, which destructures
 * `onRefresh`/`refreshing` away and renders a bare View — meaning every
 * pull-to-refresh in the app was a no-op in the browser.
 *
 * ScrollView (and therefore FlatList) renders this element as a WRAPPER around
 * the scroll node: `cloneElement(refreshControl, {style}, scrollView)`. So the
 * scroller is our last child, and we can drive refresh two ways:
 *   - touch devices: a pull gesture once the scroller sits at the top, with the
 *     indicator taking real layout height so content slides down as you pull;
 *   - pointer devices (desktop browsers, where pulling is impossible): a
 *     compact refresh bar.
 *
 * Both affordances live in normal flow, never overlapping list content.
 * Listeners are attached imperatively as passive — we never preventDefault
 * (global `overscroll-behavior-y: none` already suppresses the browser's own
 * pull-to-refresh), so scroll performance is untouched.
 */

const PULL_TRIGGER = 32;
const MAX_PULL = 52;
const SPINNER_SLOT = 36;

interface WebRefreshControlProps extends PropsWithChildren {
  refreshing?: boolean;
  onRefresh?: () => void;
  tintColor?: string;
  /** False when the page heading owns the refresh action and its loading state. */
  showButton?: boolean;
  style?: StyleProp<ViewStyle>;
}

function hasFinePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function RefreshControl({
  refreshing,
  onRefresh,
  children,
  style,
  showButton = true,
}: WebRefreshControlProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const wrapperRef = useRef<View | null>(null);
  const [pull, setPull] = useState(0);
  const [showBar, setShowBar] = useState(false);

  useEffect(() => setShowBar(hasFinePointer()), []);

  useEffect(() => {
    if (!onRefresh) return;
    const node = wrapperRef.current as unknown as HTMLElement | null;
    if (!node) return;
    // The scroll node is our last child (the bar, when present, is the first).
    const scroller = (node.lastElementChild as HTMLElement | null) ?? node;

    let startY: number | null = null;
    let distance = 0;

    const reset = () => {
      startY = null;
      distance = 0;
      setPull(0);
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || scroller.scrollTop > 0) return;
      startY = event.touches[0].clientY;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0 || scroller.scrollTop > 0) {
        reset();
        return;
      }
      distance = Math.min(dy * 0.5, MAX_PULL);
      setPull(distance);
    };
    const onEnd = () => {
      const trigger = startY !== null && distance >= PULL_TRIGGER;
      reset();
      if (trigger) onRefresh();
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: true });
    node.addEventListener('touchend', onEnd, { passive: true });
    node.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh]);

  const pulling = pull > 0 && !refreshing;
  const armed = pull >= PULL_TRIGGER;
  const slotHeight = refreshing && showButton ? SPINNER_SLOT : pulling ? pull : 0;

  return (
    <View ref={wrapperRef} style={[style, styles.wrapper]}>
      {onRefresh && showButton && showBar && (
        <View style={styles.bar}>
          <IconButton
            icon="refresh-outline"
            label={t('actions.refresh')}
            onPress={onRefresh}
            loading={refreshing}
            size={18}
          />
        </View>
      )}

      {slotHeight > 0 && (
        <View style={[styles.slot, { height: slotHeight, pointerEvents: 'none' }]}>
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name={armed ? 'arrow-down-circle' : 'arrow-down'}
              size={18}
              color={armed ? colors.primary : colors.textTertiary}
            />
          )}
        </View>
      )}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexDirection: 'column' },
  bar: { alignItems: 'flex-end', paddingHorizontal: Spacing.lg },
  slot: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
