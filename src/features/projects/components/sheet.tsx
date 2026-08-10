/**
 * Bottom sheet for the project feature (working-directory panel, file browser).
 * Same implementation as the companions / models sheets — RN `Modal` works on
 * react-native-web too, so one component covers iOS / Android / web, and both
 * the backdrop and the close button exit.
 *
 * `scrollable={false}` hands layout to the caller: the file browser renders its
 * own FlatList so pull-to-refresh works instead of nesting scrollables.
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
  onClose: () => void;
  /** Pinned action row at the bottom of the sheet. */
  footer?: ReactNode;
  closeLabel: string;
  /** Wrap the body in a ScrollView (default). */
  scrollable?: boolean;
}

export function Sheet({
  visible,
  title,
  onClose,
  footer,
  closeLabel,
  scrollable = true,
  children,
}: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={styles.backdropHit}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, Spacing.lg),
              },
            ]}
          >
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                onPress={onClose}
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={colors.textTertiary} />
              </Pressable>
            </View>

            {scrollable ? (
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
              >
                {children}
              </ScrollView>
            ) : (
              <View style={styles.body}>{children}</View>
            )}

            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropHit: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  title: { fontSize: FontSize.lg, fontWeight: '700', flexShrink: 1 },
  close: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: Spacing.sm },
  footer: { gap: Spacing.sm, marginTop: Spacing.md },
});
