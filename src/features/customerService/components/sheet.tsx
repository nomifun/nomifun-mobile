/**
 * Bottom-sheet modal — the mobile replacement for the desktop's Arco modals.
 *
 * Plain `react-native` Modal so it works on iOS, Android and
 * react-native-web without a new dependency.
 */
import type { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface SheetProps extends PropsWithChildren {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  /** Grow to most of the screen (transcripts, long lists). */
  tall?: boolean;
  /** Wrap the body in a ScrollView (default). Set false for a FlatList body. */
  scroll?: boolean;
  closeLabel: string;
}

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  footer,
  tall,
  scroll = true,
  closeLabel,
  children,
}: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const body = scroll ? (
    <ScrollView
      style={styles.flexible}
      contentContainerStyle={styles.bodyContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flexible, styles.bodyContent]}>{children}</View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Android-only; RNW/iOS ignore it, so keep it off the web prop bag.
      {...(Platform.OS === 'android' ? { statusBarTranslucent: true } : null)}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.dock}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.card,
              tall ? styles.tall : styles.auto,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, Spacing.md),
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={[styles.subtitle, { color: colors.textTertiary }]} numberOfLines={2}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                onPress={onClose}
                hitSlop={8}
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={colors.textTertiary} />
              </Pressable>
            </View>
            {body}
            {footer ? (
              <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  dock: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  card: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    overflow: 'hidden',
  },
  auto: { maxHeight: '86%' },
  tall: { height: '88%' },
  flexible: { flexShrink: 1 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.lg, fontWeight: '700' },
  subtitle: { fontSize: FontSize.xs, lineHeight: 17 },
  close: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  bodyContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
});
