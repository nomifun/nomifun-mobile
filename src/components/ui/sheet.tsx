import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { FontSize, Layout, MaxContentWidth, Motion, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { IconButton } from './icon-button';

export interface SheetProps extends PropsWithChildren {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  footer?: ReactNode;
  tall?: boolean;
  wide?: boolean;
  /** False for a body that owns its FlatList. */
  scroll?: boolean;
  /** Bounded viewport for a short virtualized list; the header remains intrinsic. */
  contentHeight?: number;
}

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  closeDisabled = false,
  closeLabel,
  footer,
  tall,
  wide,
  scroll = true,
  contentHeight,
  children,
}: SheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const entrance = useRef(new Animated.Value(0)).current;
  const desktop = Platform.OS === 'web' && width >= Layout.dialogBreakpoint;
  const maxHeight = Math.max(
    0,
    Math.min(height * 0.9, height - insets.top - insets.bottom - Spacing.xl),
  );
  const expanded = tall || (!scroll && contentHeight === undefined);

  useEffect(() => {
    entrance.stopAnimation();
    if (!visible) {
      entrance.setValue(0);
      return;
    }
    Animated.timing(entrance, {
      toValue: 1,
      duration: reduced ? 0 : Motion.normal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
    return () => entrance.stopAnimation();
  }, [entrance, reduced, visible]);

  const close = () => {
    if (!closeDisabled) onClose();
  };
  const bodyStyle = [
    styles.body,
    expanded && styles.grow,
    contentHeight !== undefined && { height: contentHeight },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={close}
      {...(Platform.OS === 'android' ? { statusBarTranslucent: true } : {})}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, desktop && styles.center, { paddingTop: insets.top }]}
      >
        <Pressable
          accessible={false}
          {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})}
          disabled={closeDisabled}
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />
        <Animated.View
          accessibilityViewIsModal
          {...(Platform.OS === 'web'
            ? { role: 'dialog' as const, 'aria-modal': true, 'aria-label': title }
            : {})}
          style={[
            styles.sheet,
            desktop && styles.dialog,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              maxWidth: wide ? MaxContentWidth : Layout.dialogWidth,
              maxHeight,
              height: expanded ? maxHeight : undefined,
              paddingBottom: desktop ? 0 : Math.max(insets.bottom, Spacing.sm),
              opacity: entrance,
              transform: [
                {
                  translateY: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [desktop ? 8 : 24, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {!desktop ? (
            <View accessible={false} style={[styles.grabber, { backgroundColor: colors.border }]} />
          ) : null}
          <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
            <View style={styles.heading}>
              <Text
                accessibilityRole="header"
                numberOfLines={2}
                style={[styles.title, { color: colors.text }]}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.textTertiary }]}>{subtitle}</Text>
              ) : null}
            </View>
            <IconButton
              icon="close"
              label={closeLabel ?? t('actions.close')}
              onPress={close}
              disabled={closeDisabled}
              size={18}
            />
          </View>
          {scroll ? (
            <ScrollView
              style={bodyStyle}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[bodyStyle, styles.content]}>{children}</View>
          )}
          {footer ? (
            <View style={[styles.footer, { borderTopColor: colors.borderLight }]}>{footer}</View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  center: { justifyContent: 'center', paddingHorizontal: Spacing.xl },
  sheet: {
    width: '100%',
    borderWidth: 1,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    overflow: 'hidden',
    flexShrink: 1,
  },
  dialog: { borderRadius: Radius.xl },
  grabber: {
    width: 32,
    height: 4,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginTop: Spacing.sm,
  },
  header: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
  },
  heading: { flex: 1, minWidth: 0, gap: Spacing.xs },
  title: { fontSize: FontSize.md, fontWeight: '600', lineHeight: 20 },
  subtitle: { fontSize: FontSize.xs, lineHeight: 18 },
  body: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  grow: { flexGrow: 1 },
  content: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  footer: { flexShrink: 0, padding: Spacing.md, gap: Spacing.sm, borderTopWidth: 1 },
});
