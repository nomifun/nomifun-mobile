import { useCallback, useMemo, useRef } from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { AppMenuButton } from '@/components/app-menu-button';
import { useTranslation } from 'react-i18next';

import { sessionErrorText } from '@/features/sessions/errors';
import { Button, EmptyState, ErrorState, Loading, Notice, Screen, toast } from '@/components/ui';
import { FontSize, Layout, Spacing } from '@/constants/theme';
import { WorkspacePanel } from '@/features/projects/components/workspace-panel';
import { useAttachments } from '@/features/sessions/attachments';
import { Composer } from '@/features/sessions/components/composer';
import VoiceEntry from '@/features/voice/components/VoiceEntry';
import { MessageItem } from '@/features/sessions/components/message-item';
import { ActivityBlock } from '@/features/sessions/components/activity-block';
import { TypingIndicator } from '@/features/sessions/components/typing-indicator';
import { useChatSession, useConversation } from '@/features/sessions/hooks';
import type { ChatMessage } from '@/features/sessions/stream';
import { projectTranscript, type TranscriptItem } from '@/features/sessions/transcript';
import { needsStamp, transcriptStamp } from '@/features/sessions/time';
import { useTheme } from '@/hooks/use-theme';

type Row = TranscriptItem & {
  /** Time divider shown above the bubble after a >10min gap. */
  stamp?: string;
};

function errorText(error: unknown, fallback: string): string {
  return sessionErrorText(error, fallback);
}

function buildRows(messages: ChatMessage[], showTools: boolean): Row[] {
  let previous: number | undefined;
  return projectTranscript(messages, showTools).map((item) => {
    const stamp = needsStamp(item.createdAt, previous)
      ? transcriptStamp(item.createdAt)
      : undefined;
    previous = item.createdAt;
    return { ...item, stamp };
  });
}

export default function SessionDetailScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const showTools = Platform.OS === 'web' && width >= Layout.dialogBreakpoint;

  const conversation = useConversation(id);
  const chat = useChatSession(id, conversation.data, () => conversation.mutate());
  const attachments = useAttachments(id);

  // Inverted keeps the newest turn pinned to the bottom for free on native.
  // react-native-web implements it with a CSS flip that reverses the mouse
  // wheel, so the browser gets a normal list plus explicit auto-scroll.
  const inverted = Platform.OS !== 'web';
  const listRef = useRef<FlatList<Row>>(null);
  const atBottom = useRef(true);

  const rows = useMemo(() => buildRows(chat.messages, showTools), [chat.messages, showTools]);
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
      const files = attachments.readyPaths;
      try {
        await chat.send(text, files);
        // The paths point at the desktop's temp dir — they are single-use, so
        // the chips go away with the send instead of being kept around.
        if (files.length > 0) attachments.clear();
        return true;
      } catch (error) {
        toast.error(
          t('composer.sendFailed', { message: errorText(error, tc('feedback.requestFailed')) }),
        );
        return false;
      }
    },
    [attachments, chat, t, tc],
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
  }, [
    chat.hasOlder,
    chat.isLoadingOlder,
    chat.loadOlder,
    chat.messages.length,
    colors.textTertiary,
    t,
  ]);

  const typing = chat.streaming ? <TypingIndicator /> : null;

  const header = (
    <Stack.Screen
      options={{
        title: conversation.data?.name?.trim() || t('detail.title'),
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <VoiceEntry session={id} />
            <AppMenuButton />
          </View>
        ),
      }}
    />
  );

  // Working-directory pill + panel (project sessions and temporary workspaces
  // alike); renders nothing while the row has no workspace.
  const workspaceBar = (
    <WorkspacePanel conversation={conversation.data} onChanged={() => void conversation.mutate()} />
  );

  const composer = (
    <Composer
      streaming={chat.streaming}
      canSend={chat.canSend && !!conversation.data && !conversation.error}
      disabledHint={t('detail.cannotSend')}
      attachments={attachments}
      conversation={conversation.data}
      onSend={handleSend}
      onStop={handleStop}
    />
  );

  if (conversation.error && !conversation.data) {
    return (
      <Screen scroll={false}>
        {header}
        <ErrorState
          message={sessionErrorText(conversation.error, t('detail.sessionLoadFailed'))}
          onRetry={() => void conversation.mutate()}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  if (conversation.isLoading || chat.isLoading) {
    return (
      <Screen scroll={false}>
        {header}
        {workspaceBar}
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  const metadataNotice = conversation.error ? (
    <View style={styles.metadataNotice}>
      <Notice tone="danger">{sessionErrorText(conversation.error, t('detail.sessionLoadFailed'))}</Notice>
      <Button variant="ghost" onPress={() => void conversation.mutate()}>{tc('actions.retry')}</Button>
    </View>
  ) : null;

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
        {metadataNotice}
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
      {metadataNotice}
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
            {item.kind === 'activity' ? (
              <ActivityBlock messages={item.messages} streaming={chat.streaming} />
            ) : (
              <MessageItem
                message={item.message}
                streaming={chat.streaming && item.message.streaming === true}
                recoveryDisabled={chat.streaming || !chat.canSend}
                onRetryRecovery={chat.retryLast}
                onRecoveryAccepted={() => {
                  void chat.refresh();
                }}
              />
            )}
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
        /**
         * No pull-to-refresh here: the transcript is already live over the
         * WebSocket, older turns load through the explicit control at the top,
         * and on web the fallback control floats a "refresh" pill over the
         * first message.
         */
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  metadataNotice: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
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
