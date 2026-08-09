import type { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ScreenProps extends PropsWithChildren {
  /** Scrollable content (default). Set false for screens that manage their own lists. */
  scroll?: boolean;
  /** Extra bottom padding for screens without a tab bar. */
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  keyboardAvoiding?: boolean;
  footer?: ReactNode;
}

/** Page wrapper: themed background, safe areas, centered column on wide web. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  refreshing,
  onRefresh,
  keyboardAvoiding = false,
  footer,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const contentStyle = [
    styles.content,
    padded && { padding: Spacing.lg },
    { paddingBottom: (padded ? Spacing.lg : 0) + Math.max(insets.bottom, Spacing.sm) },
  ];

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textTertiary}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, !padded && styles.noPad]}>{children}</View>
  );

  const column = (
    <View style={[styles.fill, styles.column]}>
      {body}
      {footer}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        >
          {column}
        </KeyboardAvoidingView>
      ) : (
        column
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  content: { flexGrow: 1 },
  noPad: { padding: 0 },
});
