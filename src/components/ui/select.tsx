import { useEffect, useId, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { FontSize, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Button } from './button';
import { SearchField } from './text-field';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectBaseProps<T extends string> {
  label: string;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  searchable?: boolean;
}

export function Select<T extends string>({
  value,
  onChange,
  ...props
}: SelectBaseProps<T> & { value?: T; onChange: (value: T) => void }) {
  return <Dropdown {...props} values={value === undefined ? [] : [value]} onSelect={onChange} />;
}

export function MultiSelect<T extends string>({
  value,
  onChange,
  ...props
}: SelectBaseProps<T> & { value: readonly T[]; onChange: (value: T[]) => void }) {
  return (
    <Dropdown
      {...props}
      multiple
      values={value}
      onSelect={(next) => onChange(value.includes(next)
        ? value.filter((item) => item !== next)
        : [...value, next])}
    />
  );
}

/** Inline so it also works inside a native Sheet without presenting another Modal. */
function Dropdown<T extends string>({
  label,
  options,
  values,
  onSelect,
  placeholder,
  hint,
  disabled = false,
  searchable = false,
  multiple = false,
}: SelectBaseProps<T> & {
  values: readonly T[];
  onSelect: (value: T) => void;
  multiple?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<View>(null);
  const triggerRef = useRef<View>(null);
  const optionRefs = useRef(new Map<T, View>());
  const pendingFocus = useRef<'first' | 'last' | null>(null);
  const suppressEscapeKeyUp = useRef(false);
  const listId = useId();
  const expanded = open && !disabled;
  const summary = values.map((value) => options.find((option) => option.value === value)?.label ?? value)
    .filter(Boolean).join('、');
  const filtered = options.filter((option) => option.label.toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!expanded) setQuery('');
    if (disabled) setOpen(false);
  }, [disabled, expanded]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !expanded || !pendingFocus.current) return;
    const enabled = options.filter((option) => !option.disabled);
    const target = enabled.find((option) => values.includes(option.value))
      ?? (pendingFocus.current === 'last' ? enabled.at(-1) : enabled[0]);
    pendingFocus.current = null;
    if (target) optionRefs.current.get(target.value)?.focus();
  }, [expanded, options, values]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !expanded) return;
    const dismissOutside = (event: Event) => {
      const root = rootRef.current as unknown as HTMLElement | null;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [expanded]);

  const close = () => {
    setOpen(false);
    if (Platform.OS === 'web') triggerRef.current?.focus();
  };

  return (
    <View
      ref={rootRef}
      style={styles.wrap}
      {...(Platform.OS === 'web' ? {
        onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
          if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopPropagation();
            suppressEscapeKeyUp.current = true;
            close();
          }
        },
        onKeyUp: (event: { key: string; stopPropagation: () => void }) => {
          // RNW Modal dismisses on keyup; Escape should close this menu first.
          if (event.key === 'Escape' && suppressEscapeKeyUp.current) {
            event.stopPropagation();
            suppressEscapeKeyUp.current = false;
          }
        },
      } : {})}
    >
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={t('select.valueLabel', {
          label, value: summary || placeholder || t('select.placeholder'),
        })}
        accessibilityValue={{ text: summary || placeholder || t('select.placeholder') }}
        accessibilityHint={hint}
        {...a11yState({ expanded, disabled })}
        {...(Platform.OS === 'web' ? {
          'aria-controls': expanded ? listId : undefined,
          onKeyDown: (event: { key: string; preventDefault: () => void }) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              pendingFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
              setOpen(true);
              if (expanded) {
                const enabled = filtered.filter((option) => !option.disabled);
                const target = event.key === 'ArrowUp' ? enabled.at(-1) : enabled[0];
                if (target) optionRefs.current.get(target.value)?.focus();
                pendingFocus.current = null;
              }
            }
          },
        } : {})}
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.field, {
          borderColor: expanded ? colors.primary : colors.border,
          backgroundColor: disabled ? colors.surfaceMuted : pressed ? colors.bgHover : colors.surface,
        }]}
      >
        <Text numberOfLines={2} style={[styles.value, {
          color: disabled ? colors.textDisabled : summary ? colors.text : colors.textTertiary,
        }]}>{summary || placeholder || t('select.placeholder')}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16}
          color={disabled ? colors.textDisabled : colors.textTertiary} />
      </Pressable>
      {expanded ? (
        <View style={[styles.menu, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {searchable ? (
            <SearchField
              accessibilityLabel={t('select.searchLabel', { label })}
              placeholder={t('select.searchPlaceholder')}
              value={query}
              onChangeText={setQuery}
              containerStyle={styles.search}
            />
          ) : null}
          <ScrollView
            nativeID={listId}
            accessibilityRole={multiple ? undefined : 'radiogroup'}
            accessibilityLabel={label}
            style={styles.options}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {filtered.map((option) => {
              const selected = values.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  ref={(node) => {
                    if (node) optionRefs.current.set(option.value, node);
                    else optionRefs.current.delete(option.value);
                  }}
                  accessibilityRole={multiple ? 'checkbox' : 'radio'}
                  accessibilityLabel={option.label}
                  {...a11yState({ checked: selected, disabled: option.disabled ?? false })}
                  disabled={option.disabled}
                  {...(Platform.OS === 'web' ? {
                    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                      if (option.disabled) return;
                      if (event.key === ' ') {
                        event.preventDefault();
                        onSelect(option.value);
                        if (!multiple) close();
                      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const enabled = filtered.filter((candidate) => !candidate.disabled);
                        const index = enabled.findIndex((candidate) => candidate.value === option.value);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
                          : (index + (event.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length;
                        const target = enabled[next];
                        if (target) optionRefs.current.get(target.value)?.focus();
                      }
                    },
                  } : {})}
                  onPress={() => {
                    onSelect(option.value);
                    if (!multiple) close();
                  }}
                  style={({ pressed }) => [styles.option, {
                    backgroundColor: selected ? colors.primarySoft : pressed ? colors.bgHover : colors.surface,
                  }]}
                >
                  <Text style={[styles.optionText, {
                    color: option.disabled ? colors.textDisabled : selected ? colors.primary : colors.text,
                  }]}>{option.label}</Text>
                  {multiple || selected ? (
                    <Ionicons name={multiple ? selected ? 'checkbox' : 'square-outline' : 'checkmark'}
                      size={18} color={selected ? colors.primary : colors.textTertiary} />
                  ) : null}
                </Pressable>
              );
            })}
            {filtered.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textTertiary }]}>{t('select.noResults')}</Text>
            ) : null}
          </ScrollView>
          {multiple ? <Button small variant="ghost" onPress={close}>{t('actions.done')}</Button> : null}
        </View>
      ) : null}
      {hint ? <Text style={[styles.hint, { color: colors.textTertiary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minWidth: 0, gap: Spacing.xs },
  label: { fontSize: FontSize.sm, fontWeight: '500' },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderWidth: 1, borderRadius: Radius.md, minHeight: Layout.controlHeight,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  value: { flex: 1, minWidth: 0, fontSize: FontSize.md, fontWeight: '500' },
  menu: { borderWidth: 1, borderRadius: Radius.md, overflow: 'hidden' },
  search: { margin: Spacing.xs, marginBottom: 0 },
  options: { maxHeight: 240, flexGrow: 0 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: Layout.compactControlHeight, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  optionText: { flex: 1, minWidth: 0, fontSize: FontSize.sm, fontWeight: '500' },
  empty: { padding: Spacing.md, fontSize: FontSize.sm },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
});
