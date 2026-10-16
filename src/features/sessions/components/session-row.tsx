import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { IconBadge, IconButton } from '@/components/ui';
import { InboxRow } from '@/components/codevisual/inbox-row';
import { FontSize } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { Conversation } from '../api';
import { relativeTime } from '../time';
import { isCompanionConversation, isProjectConversation } from '../workpath';

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
  const isCompanion = isCompanionConversation(conversation);
  /**
   * A bound project directory. Marked with a folder badge on the avatar only:
   * the enclosing section header already spells out the path, and a temporary
   * (server-provisioned) workspace is not a project at all, so it gets nothing.
   */
  const isProject = isProjectConversation(conversation) && !isCompanion;

  return (
    <InboxRow
      title={name}
      pinned={conversation.pinned === true}
      subtitle={modelLabel(conversation, t('meta.defaultModel'))}
      avatar={
        <View
          accessible
          accessibilityLabel={
            isCompanion ? t('meta.companion') : isProject ? t('meta.projectSession') : undefined
          }
        >
          <IconBadge
            icon={isCompanion ? 'sparkles' : isProject ? 'folder' : 'chatbubble-ellipses'}
            tone={isCompanion ? 'brand' : 'primary'}
            size={36}
          />
        </View>
      }
      onPress={onPress}
      onLongPress={onLongPress}
      action={
        <IconButton
          icon="ellipsis-horizontal"
          label={`${tc('actions.more')} · ${name}`}
          onPress={onLongPress}
        />
      }
      meta={
        <View style={styles.metaRow}>
          {conversation.pinned ? <Ionicons name="pin" size={12} color={colors.primary} /> : null}
          <Text style={[styles.time, { color: colors.textTertiary }]}>
            {relativeTime(conversation.modified_at, tc)}
          </Text>
        </View>
      }
      detail={
        generating ? (
          <View style={styles.metaRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.time, { color: colors.primary }]}>{t('list.generating')}</Text>
          </View>
        ) : isCompanion ? (
          <Text style={[styles.time, { color: colors.textTertiary }]}>{t('meta.companion')}</Text>
        ) : null
      }
    />
  );
});

const styles = StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: FontSize.xs },
});
