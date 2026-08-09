import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Avatar, ListRow, Tag } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { Conversation } from '../api';
import { relativeTime } from '../time';

interface SessionRowProps {
  conversation: Conversation;
  generating: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

/** Model / platform hint shown under the session name. */
function modelLabel(conversation: Conversation, fallback: string): string {
  const model = conversation.model;
  const name = model?.use_model || model?.model;
  const label = name || fallback;
  return conversation.type && conversation.type !== 'nomi'
    ? `${conversation.type} · ${label}`
    : label;
}

export const SessionRow = memo(function SessionRow({
  conversation,
  generating,
  onPress,
  onLongPress,
}: SessionRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');

  const name = conversation.name?.trim() || t('list.untitled');
  const isCompanion =
    conversation.extra?.companion_session === true || conversation.extra?.companion_session === 1;

  return (
    <ListRow
      title={name}
      subtitle={modelLabel(conversation, t('meta.defaultModel'))}
      left={<Avatar name={name} />}
      onPress={onPress}
      onLongPress={onLongPress}
      chevron
      right={
        <View style={styles.right}>
          <View style={styles.metaRow}>
            {conversation.pinned ? (
              <Ionicons name="pin" size={12} color={colors.primary} />
            ) : null}
            <Text style={[styles.time, { color: colors.textTertiary }]}>
              {relativeTime(conversation.modified_at, tc)}
            </Text>
          </View>
          {generating ? (
            <View style={styles.metaRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.time, { color: colors.primary }]}>{t('list.generating')}</Text>
            </View>
          ) : isCompanion ? (
            <Tag tone="primary">{t('meta.companion')}</Tag>
          ) : null}
        </View>
      }
    />
  );
});

const styles = StyleSheet.create({
  right: { alignItems: 'flex-end', gap: Spacing.xs, maxWidth: 130 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: FontSize.xs },
});
