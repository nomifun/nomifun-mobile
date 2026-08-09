/**
 * Pick sheet — the native replacement for Arco `Select` / `Select
 * mode='multiple'`. Single mode closes on pick; multiple mode toggles and stays
 * open behind a 完成 button.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { CheckRow } from './controls';
import { Sheet } from './sheet';

export interface PickItem {
  id: string;
  title: string;
  subtitle?: string;
}

interface PickSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  items: readonly PickItem[];
  /** Selected ids (one entry in single mode). */
  selected: readonly string[];
  multiple?: boolean;
  emptyText?: string;
  /** Extra row that clears the value (single mode only). */
  clearOption?: { title: string; subtitle?: string };
  onPick: (id: string) => void;
  onClose: () => void;
  footer?: ReactNode;
}

export function PickSheet({
  visible,
  title,
  subtitle,
  items,
  selected,
  multiple,
  emptyText,
  clearOption,
  onPick,
  onClose,
  footer,
}: PickSheetProps) {
  const { colors } = useTheme();
  const { t: tc } = useTranslation('common');

  const pick = (id: string) => {
    onPick(id);
    if (!multiple) onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      closeLabel={tc('actions.close')}
      footer={
        footer ??
        (multiple ? <Button onPress={onClose}>{tc('actions.done')}</Button> : undefined)
      }
    >
      {clearOption ? (
        <CheckRow
          title={clearOption.title}
          subtitle={clearOption.subtitle}
          checked={selected.length === 0}
          onPress={() => pick('')}
        />
      ) : null}

      {items.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textTertiary }]}>
          {emptyText ?? tc('state.empty')}
        </Text>
      ) : (
        <View>
          {items.map((item) => (
            <CheckRow
              key={item.id}
              title={item.title}
              subtitle={item.subtitle}
              checked={selected.includes(item.id)}
              onPress={() => pick(item.id)}
            />
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
});
