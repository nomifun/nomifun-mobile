import { useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { FontSize, FontWeight, Layout, Motion, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { IconButton } from './icon-button';

const webInputReset =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined;

interface TextFieldProps extends TextInputProps {
  variant?: 'form' | 'search';
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  onClear?: () => void;
  clearLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

export function TextField({
  variant = 'form',
  label,
  hint,
  error,
  style,
  leadingIcon,
  onClear,
  clearLabel,
  containerStyle,
  secureTextEntry,
  ...rest
}: TextFieldProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(Boolean(rest.autoFocus));
  const [revealed, setRevealed] = useState(false);
  const inactive = rest.editable === false;
  const search = variant === 'search';
  const border = error ? colors.danger : focused ? colors.primary : colors.border;
  const surface = [
    { borderColor: border, backgroundColor: inactive ? colors.surfaceMuted : colors.surface },
    Platform.OS === 'web' &&
      ({
        transition: `border-color ${Motion.fast}ms, box-shadow ${Motion.fast}ms`,
        boxShadow: focused ? `0 0 0 3px ${colors.focusRing}` : 'none',
      } as ViewStyle),
  ];
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={[styles.label, { color: colors.text }]}>{label}</Text> : null}
      <View style={[styles.field, search ? styles.searchTarget : surface]}>
        {search ? <View pointerEvents="none" style={[styles.searchSurface, surface]} /> : null}
        {leadingIcon ? (
          <Ionicons
            name={leadingIcon}
            size={search ? 16 : 18}
            color={colors.textTertiary}
            style={styles.leading}
          />
        ) : null}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label ?? rest.placeholder}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
          secureTextEntry={!!secureTextEntry && !revealed}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          style={[
            styles.input,
            search && styles.searchInput,
            webInputReset,
            {
              color: inactive ? colors.textSecondary : colors.text,
            },
            style,
          ]}
        />
        {secureTextEntry ? (
          <IconButton
            icon={revealed ? 'eye-off-outline' : 'eye-outline'}
            label={t(revealed ? 'actions.hidePassword' : 'actions.showPassword')}
            onPress={() => setRevealed(!revealed)}
            disabled={inactive}
          />
        ) : onClear && !!rest.value ? (
          <IconButton
            icon="close"
            label={clearLabel ?? t('actions.clear')}
            onPress={() => {
              onClear();
              inputRef.current?.focus();
            }}
            disabled={inactive}
            size={18}
          />
        ) : null}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.danger }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function SearchField(
  props: Omit<TextFieldProps, 'variant' | 'multiline' | 'secureTextEntry'>,
) {
  return (
    <TextField leadingIcon="search-outline" returnKeyType="search" {...props} variant="search" />
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg, minWidth: 0 },
  label: { fontSize: FontSize.sm, fontWeight: '500', marginBottom: Spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    minHeight: Layout.controlHeight,
  },
  leading: { marginLeft: Spacing.md },
  searchTarget: { height: Layout.controlHeight, borderWidth: 0 },
  searchSurface: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (Layout.controlHeight - Layout.searchHeight) / 2,
    height: Layout.searchHeight,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  searchInput: {
    position: 'relative',
    height: Layout.controlHeight,
    paddingVertical: 0,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.sm,
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontSize: FontSize.md,
    fontWeight: FontWeight.body,
    minHeight: Layout.controlHeight,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.body,
    lineHeight: 17,
    marginTop: Spacing.xs,
  },
});
