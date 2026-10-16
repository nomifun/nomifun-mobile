import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Layout, Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

export function NavigationDrawer({
  visible,
  onClose,
  children,
}: PropsWithChildren<{ visible: boolean; onClose: () => void }>) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const drawerWidth = Math.min(Layout.sidebarWidth, width - 48);
  const [present, setPresent] = useState(visible);
  const slide = useRef(new Animated.Value(-drawerWidth)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) setPresent(true);
    const animation = Animated.parallel([
      Animated.timing(slide, {
        toValue: visible ? 0 : -drawerWidth,
        duration: reduced ? 0 : Motion.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: reduced ? 0 : Motion.normal,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished && !visible) setPresent(false);
    });
    return () => animation.stop();
  }, [drawerWidth, opacity, reduced, slide, visible]);
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx < -14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -64) onClose();
        },
      }),
    [onClose],
  );
  return (
    <Modal
      visible={present}
      transparent
      animationType="none"
      onRequestClose={onClose}
      {...(Platform.OS === 'android' ? { statusBarTranslucent: true } : {})}
    >
      <View style={styles.fill}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity }]}
        >
          <Pressable
            accessible={false}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
            {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          {...swipe.panHandlers}
          {...(Platform.OS === 'web'
            ? { role: 'dialog' as const, 'aria-modal': true, 'aria-label': t('navigation.title') }
            : {})}
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              backgroundColor: colors.surface,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 }, drawer: { height: '100%' } });
