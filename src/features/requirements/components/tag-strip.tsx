import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/ui';
import { Spacing } from '@/constants/theme';

import type { TagSummary } from '../types';

interface TagStripProps {
  tags: TagSummary[];
  /** Undefined = no tag filter. */
  selected?: string;
  onSelect: (tag?: string) => void;
}

/**
 * Compact tag summary strip: one chip per queue with its total, plus a pause
 * marker when AutoWork stopped claiming that tag.
 */
export function TagStrip({ tags, selected, onSelect }: TagStripProps) {
  const { t } = useTranslation('requirements');
  if (tags.length === 0) return null;

  const total = tags.reduce((sum, item) => sum + item.total, 0);

  return (
    <SegmentedControl
      variant="chips"
      scrollable
      style={styles.viewport}
      value={selected === undefined ? 'all' : `tag:${selected}`}
      options={[
        { value: 'all', label: t('filter.allTags'), badge: total },
        ...tags.map((item) => ({
          value: `tag:${item.tag}`,
          label: item.tag,
          badge: item.total,
          icon: item.paused ? ('pause-circle-outline' as const) : undefined,
        })),
      ]}
      onChange={(value) => {
        const next = value === 'all' ? undefined : value.slice(4);
        onSelect(next === selected ? undefined : next);
      }}
    />
  );
}

const styles = StyleSheet.create({
  viewport: { marginHorizontal: Spacing.lg },
});
