import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/ui';
import { Spacing } from '@/constants/theme';

import { STATUS_FILTERS, type StatusFilter } from '../types';

interface StatusFilterBarProps {
  value: StatusFilter;
  /** Per-status totals from the tag summaries; omitted counts render bare. */
  counts?: Partial<Record<StatusFilter, number>>;
  onChange: (value: StatusFilter) => void;
}

/**
 * Segmented control across the top of the list. Scrolls horizontally because
 * the platform has six statuses plus "all".
 */
export function StatusFilterBar({ value, counts, onChange }: StatusFilterBarProps) {
  const { t } = useTranslation('requirements');

  return (
    <SegmentedControl
      variant="chips"
      scrollable
      style={styles.viewport}
      options={STATUS_FILTERS.map((option) => ({
        value: option,
        label: option === 'all' ? t('filter.all') : t(`status.${option}`),
        badge: counts?.[option],
      }))}
      value={value}
      onChange={onChange}
    />
  );
}

const styles = StyleSheet.create({
  viewport: { marginHorizontal: Spacing.lg },
});
