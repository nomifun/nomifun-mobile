/**
 * One tappable row in the directory picker — a folder to descend into, or a
 * shortcut on the start screen. Wraps the shared `ListRow` so the browser looks
 * like every other list in the app.
 */
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { ListRow } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

interface DirectoryEntryRowProps {
  name: string;
  /** Unix epoch ms; rendered as the row subtitle when no explicit hint is given. */
  modified?: number;
  /** Takes precedence over `modified` (used for shortcut hints / target paths). */
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export function DirectoryEntryRow({
  name,
  modified,
  hint,
  icon = 'folder-outline',
  onPress,
}: DirectoryEntryRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('fs');

  const subtitle =
    hint ?? (modified ? t('picker.modified', { time: dayjs(modified).format('YYYY-MM-DD HH:mm') }) : undefined);

  return (
    <ListRow
      title={name}
      subtitle={subtitle}
      left={<Ionicons name={icon} size={22} color={colors.primary} />}
      chevron
      onPress={onPress}
    />
  );
}
