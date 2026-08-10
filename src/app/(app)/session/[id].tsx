import { useCallback, useMemo, useRef } from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/types';
import { Button, EmptyState, ErrorState, Loading, Screen, toast } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Spacing } from '@/constants/theme';
import { WorkspacePanel } from '@/features/projects/components/workspace-panel';
import { Composer } from '@/features/sessions/components/composer';
import { MessageItem } from '@/features/sessions/components/message-item';
import { TypingIndicator } from '@/features/sessions/components/typing-indicator';
import { useChatSession, useConversation } from '@/features/sessions/hooks';
import type { ChatMessage } from '@/features/sessions/stream';
import { needsStamp, transcriptStamp } from '@/features/sessions/time';
import { useTheme } from '@/hooks/use-theme';

interface Row {
  key: string;
  message: ChatMessage;
  /** Time divider shown above the bubble after a >10min gap. */
  stamp?: string;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function buildRows(messages: ChatMessage[]): Row[] {
  let previous: number | undefined;
  return messages.map((message) => {
    const stamp = needsStamp(message.createdAt, previous)
      ? transcriptStamp(message.createdAt)
      : undefined;
    previous = message.createdAt;
    return { key: message.key, message, stamp };
  });
}

export default function SessionDetailScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');
  const { id } = useLocalSearchParams<{ id: string }>();

  const conversation = useConversation(id);
  const chat = useChatSession(id, conversation.data);

  // Inverted keeps the newest turn pinned to the bottom for free on native.
  // react-native-web implements it with a CSS flip that reverses the mouse
  // wheel, so the browser gets a normal list plus explicit auto-scroll.
  const inverted = Platform.OS !== 'web';
  const listRef = useRef<FlatList<Row>>(null);
  const atBottom = useRef(true);

  const rows = useMemo(() => buildRows(chat.messages), [chat.messages]);
  const data = useMemo(() => (inverted ? [...rows].reverse() : rows), [inverted, rows]);

  const onContentSizeChange = useCallback(() => {
    if (inverted || !atBottom.current) return;
    listRef.current?.scrollToEnd({ animated: false });
  }, [inverted]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (inverted) return;
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
    },
    [inverted],
  );

  const handleSend = useCallback(
    async (text: string) => {
      try {
        await chat.send(text);
        return true;
      } catch (error) {
        toast.error(
          t('composer.sendFailed', { message: errorText(error, tc('feedback.requestFailed')) }),
        );
        return false;
      }
    },
    [chat, t, tc],
  );

  const handleStop = useCallback(() => {
    void chat
      .stop()
      .then(() => toast.info(t('composer.stopRequested')))
      .catch((error: unknown) =>
        toast.error(
          t('composer.stopFailed', { message: errorText(error, tc('feedback.requestFailed')) }),
        ),
      );
  }, [chat, t, tc]);

  const olderControl = useMemo(() => {
    if (chat.isLoadingOlder) {
      return (
        <Text style={[styles.notice, { color: colors.textTertiary }]}>
          {t('detail.loadingOlder')}
        </Text>
      );
    }
    if (chat.hasOlder) {
      return (
        <View style={styles.olderButton}>
          <Button variant="secondary" small onPress={chat.loadOlder}>
            {t('detail.loadOlder')}
          </Button>
        </View>
      );
    }
    if (chat.messages.length > 0) {
      return (
        <Text style={[styles.notice, { color: colors.textTertiary }]}>
          {t('detail.historyStart')}
        </Text>
      );
    }
    return null;
  }, [chat.hasOlder, chat.isLoadingOlder, chat.loadOlder, chat.messages.length, colors.textTertiary, t]);

  const typing = chat.streaming ? <TypingIndicator /> : null;

  const header = (
    <Stack.Screen
      options={{ title: conversation.data?.name?.trim() || t('detail.title') }}
    />
  );

  // Working-directory pill + panel (project sessions and temporary workspaces
  // alike); renders nothing while the row has no workspace.
  const workspaceBar = (
    <WorkspacePanel
      conversation={conversation.data}
      onChanged={() => void conversation.mutate()}
    />
  );

  const composer = (
    <Composer
      streaming={chat.streaming}
      canSend={chat.canSend}
      disabledHint={t('detail.cannotSend')}
      onSend={handleSend}
      onStop={handleStop}
    />
  );

  if (chat.isLoading) {
    return (
      <Screen scroll={false}>
        {header}
        {workspaceBar}
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (chat.error && chat.messages.length === 0) {
    return (
      <Screen scroll={false}>
        {header}
        {workspaceBar}
        <ErrorState
          message={errorText(chat.error, t('detail.loadFailed'))}
          onRetry={chat.retry}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  if (chat.messages.length === 0) {
    // Rendered outside the list: an inverted FlatList mirrors its empty slot.
    return (
      <Screen scroll={false} keyboardAvoiding footer={composer}>
        {header}
        {workspaceBar}
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title={t('detail.emptyTitle')}
          description={t('detail.emptyHint')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} keyboardAvoiding footer={composer}>
      {header}
      {workspaceBar}
      <FlatList
        ref={listRef}
        data={data}
        inverted={inverted}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <View>
            {item.stamp ? (
              <Text style={[styles.stamp, { color: colors.textTertiary }]}>{item.stamp}</Text>
            ) : null}
            <MessageItem message={item.message} />
          </View>
        )}
        ListHeaderComponent={inverted ? typing : olderControl}
        ListFooterComponent={inverted ? olderControl : typing}
        onEndReached={inverted ? chat.loadOlder : undefined}
        onEndReachedThreshold={0.5}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        refreshControl={
          <RefreshControl
            refreshing={chat.isRefreshing}
            onRefresh={() => void chat.refresh()}
            tintColor={colors.textTertiary}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.md },
  stamp: {
    fontSize: FontSize.xs,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  notice: { fontSize: FontSize.xs, textAlign: 'center', paddingVertical: Spacing.md },
  olderButton: { alignItems: 'center', paddingVertical: Spacing.sm },
});
