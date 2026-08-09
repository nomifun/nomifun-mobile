import type { PropsWithChildren } from 'react';
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
  /** Sticky area under the scrollable body (primary action). */
  footer?: React.ReactNode;
}

/**
 * Bottom sheet used instead of the desktop's popovers-in-popovers.
 * `Modal` is implemented by react-native-web too, so this works on all three
 * targets without a platform branch.
 */
export function Sheet({ visible, title, onClose, footer, children }: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable
          accessible={false}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.dock}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, Spacing.md),
              },
            ]}
          >
            <View style={[styles.header, { borderColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                hitSlop={12}
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={colors.textTertiary} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dock: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', maxHeight: '88%' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: FontSize.lg, fontWeight: '700' },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0 },
  bodyContent: { padding: Spacing.lg, gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
});
