import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { api } from '@/api/client';
import { connectionStore } from '@/api/connection';
import { useConnection } from '@/hooks/use-connection';
import { Button, Screen } from '../components/VoiceUI';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { conversationsPath, type Conversation, type Paginated } from '@/features/sessions/api';
import {
  operationIdentity,
  probeVoiceProfile,
  saveVoiceProfile,
  voiceAvailability,
  voiceCatalog,
} from '../api';
import { voiceController, voiceTransports, useVoice } from '../runtime';
import type { Transport, VoiceModelChoice, WorkSteeringPolicy } from '../contracts';
import type { VoiceProfileProbeResult } from '../contracts.generated';
import { bindingFromAvailability } from '../profile';

export default function VoiceScreen() {
  const { t } = useTranslation('voice');
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ session?: string }>();
  const connection = useConnection();
  const snapshot = useVoice();
  const owner =
    connection.phase === 'connected'
      ? `${connection.binding.baseUrl}:${connection.binding.user?.user_id}`
      : '';
  const [session, setSession] = useState(
    params.session ?? snapshot.binding?.agent_session_id ?? '',
  );
  const [model, setModel] = useState<VoiceModelChoice>();
  const [transport, setTransport] = useState<Transport>();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [role, setRole] = useState('default');
  const [workSteeringPolicy, setWorkSteeringPolicy] = useState<WorkSteeringPolicy>('safe_boundary');
  const [probeResult, setProbeResult] = useState<VoiceProfileProbeResult>();
  const [volume, setVolume] = useState(() => voiceController.getVolume());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const { data: sessions } = useSWR(owner ? ['voice-sessions', owner] : null, () =>
    api<Paginated<Conversation>>(conversationsPath(undefined, 100)),
  );
  const { data: catalog, error: catalogError } = useSWR(
    owner ? ['voice-catalog', owner] : null,
    voiceCatalog,
    { shouldRetryOnError: false },
  );
  const { data: availability, mutate } = useSWR(
    session && owner ? ['voice-availability', owner, session] : null,
    () => voiceAvailability(session),
    { shouldRetryOnError: false },
  );
  const active =
    snapshot.role === 'active' &&
    ['opening', 'ready', 'recovering', 'closing'].includes(snapshot.connection);
  const observing =
    snapshot.role === 'observer' &&
    ['opening', 'ready', 'recovering'].includes(snapshot.connection);
  const bound = active || observing ? snapshot.binding : undefined;
  const choices = (catalog?.models ?? []).filter(
    (choice) =>
      choice.full_duplex === 'supported' &&
      choice.transports.some((value) => voiceTransports.includes(value)),
  );
  useEffect(() => {
    if (!session && snapshot.binding?.agent_session_id)
      setSession(snapshot.binding.agent_session_id);
  }, [snapshot.binding?.agent_session_id]);
  useEffect(() => {
    setWorkSteeringPolicy(availability?.profile?.work_steering_policy ?? 'safe_boundary');
    setProbeResult(undefined);
  }, [session, availability?.profile?.profile_id, availability?.profile?.revision]);
  const act = (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    void operation()
      .catch((value) => setError(value instanceof Error ? value.message : t('unavailable')))
      .finally(() => setBusy(false));
  };
  const start = (takeover = false) =>
    act(async () => {
      const current = await mutate();
      if (!current?.enabled || !current.profile) throw new Error(t('profileRequired'));
      const selectedTransport = current.transport;
      if (!selectedTransport || !voiceTransports.includes(selectedTransport))
        throw new Error(t('transportUnavailable'));
      const binding = bindingFromAvailability(
        current,
        voiceTransports,
        session,
        sessions?.items.find((value) => value.conversation_id === session)?.name ?? session,
      );
      await voiceController.start(binding, takeover);
    });
  const save = () =>
    act(async () => {
      if (!model || !transport || !availability) throw new Error(t('chooseModel'));
      await saveVoiceProfile(
        availability.profile?.profile_id ?? `mobile-${operationIdentity()}`,
        availability.profile?.revision ?? 0,
        session,
        availability.binding_version,
        model,
        transport,
        config,
        role,
        workSteeringPolicy,
      );
      await mutate();
      setConfiguring(false);
    });
  const stopWork = () =>
    act(async () => {
      const target = snapshot.lastReceipt?.target;
      if (!target) throw new Error(t('workTargetUnknown'));
      await voiceController.work({ action: 'cancel', target });
    });
  const probe = () =>
    act(async () => {
      setProbeResult(undefined);
      if (!availability?.enabled || !availability.profile) throw new Error(t('profileRequired'));
      setProbeResult(
        await probeVoiceProfile(availability.profile, session, availability.binding_version),
      );
    });
  const server = connectionStore.binding()?.baseUrl || t('pairedDesktop');
  const title =
    bound?.label ??
    sessions?.items.find((value) => value.conversation_id === session)?.name ??
    t('selectSession');
  const sourceContext = snapshot.sourceContextRequirement;
  const sourceContextText = sourceContext && voiceController.sourceContextText(sourceContext);
  const sourceContextDisabled =
    busy ||
    !active ||
    snapshot.connection !== 'ready' ||
    !sourceContextText ||
    !sourceContext?.context.target;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('title') }} />
      <View style={styles.topline}>
        <Text style={[styles.eyebrow, { color: colors.textTertiary }]}>{t('subtitle')}</Text>
        <View style={[styles.privateBadge, { backgroundColor: colors.successSoft }]}>
          <Ionicons name="shield-checkmark-outline" size={12} color={colors.success} />
          <Text style={[styles.privateText, { color: colors.success }]}>{t('foregroundOnly')}</Text>
        </View>
      </View>
      <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="mic-outline" size={34} color={colors.primary} />
        </View>
        <Text style={[styles.heading, { color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.server, { color: colors.textTertiary }]} numberOfLines={1}>
          {server}
        </Text>
        <View style={styles.statuses}>
          <State
            label={t(`connection.${snapshot.connection}`)}
            color={snapshot.connection === 'ready' ? colors.success : colors.textTertiary}
          />
          {(active || observing) && (
            <State
              label={observing ? t('observer') : t(`microphone.${snapshot.microphone}`)}
              color={snapshot.microphone === 'capturing' ? colors.primary : colors.textTertiary}
            />
          )}
          {snapshot.workRunning && <State label={t('workContinues')} color={colors.primary} />}
        </View>
        {active && (
          <View style={styles.level} accessibilityLabel={t(`microphone.${snapshot.microphone}`)}>
            {Array.from({ length: 17 }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.levelBar,
                  {
                    backgroundColor: colors.primary,
                    opacity:
                      snapshot.microphone === 'capturing' ? 0.45 + snapshot.level * 0.55 : 0.2,
                    height: 4 + (1 - Math.abs(index - 8) / 9) * snapshot.level * 28,
                  },
                ]}
              />
            ))}
          </View>
        )}
        {(active || observing) && (
          <View style={styles.actions}>
            {active ? (
              <>
                <Button
                  small
                  variant="secondary"
                  disabled={!['ready', 'recovering'].includes(snapshot.connection)}
                  onPress={() => act(() => voiceController.microphone())}
                >
                  {t(voiceController.wantsMicrophone() ? 'pauseMic' : 'resumeMic')}
                </Button>
                <Button
                  small
                  variant="secondary"
                  disabled={snapshot.connection !== 'ready'}
                  onPress={() => act(() => voiceController.stopSpeaking())}
                >
                  {t('stopSpeaking')}
                </Button>
              </>
            ) : (
              <Button
                small
                onPress={() => {
                  if (snapshot.binding) act(() => voiceController.start(snapshot.binding!, true));
                }}
              >
                {t('takeover')}
              </Button>
            )}
            <Button small variant="ghost" onPress={() => act(() => voiceController.end())}>
              {t(observing ? 'stopObserving' : 'end')}
            </Button>
          </View>
        )}
        {active && snapshot.connection === 'recovering' && (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t(voiceController.wantsMicrophone() ? 'relayRecoveryWanted' : 'relayRecoveryPaused')}
          </Text>
        )}
        {bound && (
          <Button
            small
            variant="ghost"
            onPress={() => router.push(`/session/${bound.agent_session_id}`)}
          >
            {t('openSession')}
          </Button>
        )}
      </View>
      {(error || snapshot.error || catalogError) && (
        <View
          style={[styles.notice, { backgroundColor: colors.warningSoft }]}
          accessibilityRole="alert"
        >
          <Text style={[styles.noticeText, { color: colors.warning }]}>
            {error || snapshot.error || t('desktopUnsupported')}
          </Text>
        </View>
      )}
      {sourceContext && (
        <View
          style={[styles.notice, { backgroundColor: colors.warningSoft }]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.modelHeading}>
            <Text style={[styles.modelTitle, { color: colors.text }]}>
              {t('sourceContextTitle')}
            </Text>
            <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.warning} />
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('sourceContextHint')}
          </Text>
          <View style={[styles.sourceQuote, { borderColor: colors.warning }]}>
            <Text style={[styles.captionText, { color: colors.text }]}>
              {sourceContextText ? `“${sourceContextText}”` : t('sourceContextMissing')}
            </Text>
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('sourceContextTarget')}
          </Text>
          <Text selectable style={[styles.receiptText, { color: colors.text }]}>
            {sourceContext.context.target?.turn_operation_id ?? t('sourceContextNoTask')}
          </Text>
          {snapshot.role === 'observer' ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('sourceContextObserver')}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('confirmSourceContext')}
              {...a11yState({ disabled: Boolean(sourceContextDisabled), busy })}
              disabled={Boolean(sourceContextDisabled)}
              onPress={() => act(() => voiceController.confirmSourceContext(sourceContext))}
              style={({ pressed }) => [
                styles.sourceConfirm,
                {
                  backgroundColor: colors.primary,
                  opacity: sourceContextDisabled ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[styles.sourceConfirmText, { color: colors.onPrimary }]}>
                {t('confirmSourceContext')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {!active && !observing && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('session')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pills}
          >
            {sessions?.items.map((value) => (
              <Pressable
                key={value.conversation_id}
                accessibilityRole="button"
                {...a11yState({ selected: session === value.conversation_id })}
                onPress={() => {
                  setSession(value.conversation_id);
                  setModel(undefined);
                  setTransport(undefined);
                }}
                style={[
                  styles.pill,
                  {
                    borderColor: session === value.conversation_id ? colors.primary : colors.border,
                    backgroundColor:
                      session === value.conversation_id ? colors.primarySoft : colors.surface,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.pillText,
                    {
                      color:
                        session === value.conversation_id ? colors.primary : colors.textSecondary,
                    },
                  ]}
                >
                  {value.name || t('unnamedSession')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('profile')}</Text>
            <Button small variant="ghost" onPress={() => setConfiguring(!configuring)}>
              {t('configure')}
            </Button>
          </View>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('profileHint')}</Text>
          {availability?.profile && (
            <View style={[styles.profileSummary, { backgroundColor: colors.surfaceMuted }]}>
              <View style={styles.modelHeading}>
                <Text style={[styles.modelTitle, { color: colors.text }]}>
                  {availability.profile.label}
                </Text>
                <Text style={[styles.fact, { color: colors.textTertiary }]}>
                  {t(`transport.${availability.profile.route.transport}`)}
                </Text>
              </View>
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {availability.profile.route.provider_id} · {availability.profile.route.model}
              </Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                {t(
                  `steeringPolicy.${availability.profile.work_steering_policy ?? 'safe_boundary'}`,
                )}
              </Text>
              <Button
                small
                variant="secondary"
                disabled={
                  busy || !availability.enabled || availability.profile.route.transport !== 'relay'
                }
                onPress={probe}
              >
                {t('probeConnection')}
              </Button>
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {t(
                  availability.profile.route.transport === 'relay'
                    ? 'probeConnectionHint'
                    : 'probeRtcUnavailable',
                )}
              </Text>
              {probeResult?.profile_id === availability.profile.profile_id &&
                probeResult.profile_revision === availability.profile.revision && (
                  <Text
                    style={[
                      styles.hint,
                      {
                        color:
                          probeResult.connection_verified &&
                          probeResult.termination.finalization_confirmed
                            ? colors.success
                            : colors.warning,
                      },
                    ]}
                  >
                    {t(
                      !probeResult.connection_verified
                        ? 'probeUnconfirmed'
                        : probeResult.termination.finalization_confirmed
                          ? 'probeVerified'
                          : 'probeCleanupUnconfirmed',
                    )}
                  </Text>
                )}
            </View>
          )}
          {(configuring || !availability?.enabled) && (
            <View style={styles.models}>
              {choices.map((choice) => (
                <Pressable
                  key={`${choice.provider_id}:${choice.model}:${choice.adapter_id}`}
                  accessibilityRole="button"
                  {...a11yState({ selected: model === choice })}
                  onPress={() => {
                    setModel(choice);
                    setConfig({});
                    setRole(
                      choice.connection_roles.includes('default')
                        ? 'default'
                        : (choice.connection_roles[0] ?? 'default'),
                    );
                    setTransport(
                      choice.transports.find((value) => voiceTransports.includes(value)),
                    );
                  }}
                  style={[
                    styles.model,
                    {
                      backgroundColor: colors.surface,
                      borderColor: model === choice ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <View style={styles.modelHeading}>
                    <Text style={[styles.modelTitle, { color: colors.text }]}>{choice.label}</Text>
                    <Ionicons
                      name={model === choice ? 'checkmark-circle' : 'ellipse-outline'}
                      size={19}
                      color={model === choice ? colors.primary : colors.textTertiary}
                    />
                  </View>
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    {choice.provider_id} · {choice.descriptor.label}
                  </Text>
                  <Text style={[styles.evidence, { color: colors.textTertiary }]}>
                    {choice.evidence}
                  </Text>
                </Pressable>
              ))}
              {choices.length === 0 && (
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  {voiceTransports.length
                    ? t('noVerifiedModel')
                    : t(
                        Platform.OS === 'web' ? 'secureConnectionRequired' : 'nativeModuleRequired',
                      )}
                </Text>
              )}
              {model && (
                <View style={[styles.pills, { flexWrap: 'wrap' }]}>
                  {model.transports
                    .filter((value) => voiceTransports.includes(value))
                    .map((value) => (
                      <Button
                        key={value}
                        small
                        variant={transport === value ? 'primary' : 'secondary'}
                        onPress={() => setTransport(value)}
                      >
                        {t(`transport.${value}`)}
                      </Button>
                    ))}
                </View>
              )}
              {model && model.connection_roles.length > 1 && (
                <View style={[styles.pills, { flexWrap: 'wrap' }]}>
                  {model.connection_roles.map((value) => (
                    <Button
                      key={value}
                      small
                      variant={role === value ? 'primary' : 'secondary'}
                      onPress={() => setRole(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </View>
              )}
              <View style={styles.option}>
                <Text style={[styles.modelTitle, { color: colors.text }]}>
                  {t('steeringPolicyTitle')}
                </Text>
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  {t('steeringPolicyHint')}
                </Text>
                {(['safe_boundary', 'supersede_model_step'] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    {...a11yState({ checked: workSteeringPolicy === value })}
                    onPress={() => setWorkSteeringPolicy(value)}
                    style={[
                      styles.model,
                      {
                        backgroundColor: colors.surface,
                        borderColor: workSteeringPolicy === value ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <View style={styles.modelHeading}>
                      <Text style={[styles.modelTitle, { color: colors.text }]}>
                        {t(`steeringPolicy.${value}`)}
                      </Text>
                      <Ionicons
                        name={workSteeringPolicy === value ? 'checkmark-circle' : 'ellipse-outline'}
                        size={19}
                        color={workSteeringPolicy === value ? colors.primary : colors.textTertiary}
                      />
                    </View>
                    <Text style={[styles.hint, { color: colors.textTertiary }]}>
                      {t(`steeringPolicyDescription.${value}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {model &&
                Object.entries(model.config_schema.properties ?? {}).map(([key, property]) => (
                  <View key={key} style={styles.option}>
                    <Text style={[styles.hint, { color: colors.textSecondary }]}>
                      {property.title ?? key}
                    </Text>
                    {property.enum ? (
                      <View style={[styles.pills, { flexWrap: 'wrap' }]}>
                        {property.enum.map((value) => (
                          <Button
                            key={value}
                            small
                            variant={
                              (config[key] ?? property.default) === value ? 'primary' : 'secondary'
                            }
                            onPress={() => setConfig({ ...config, [key]: value })}
                          >
                            {value}
                          </Button>
                        ))}
                      </View>
                    ) : property.type === 'boolean' ? (
                      <Button
                        small
                        variant="secondary"
                        onPress={() =>
                          setConfig({ ...config, [key]: !Boolean(config[key] ?? property.default) })
                        }
                      >
                        {t(Boolean(config[key] ?? property.default) ? 'on' : 'off')}
                      </Button>
                    ) : ['string', 'number', 'integer'].includes(property.type ?? '') ? (
                      <TextInput
                        accessibilityLabel={property.title ?? key}
                        value={String(config[key] ?? property.default ?? '')}
                        keyboardType={property.type === 'string' ? 'default' : 'numeric'}
                        onChangeText={(value) =>
                          setConfig({
                            ...config,
                            [key]: property.type === 'string' ? value : Number(value),
                          })
                        }
                        style={[
                          styles.optionInput,
                          {
                            borderColor: colors.border,
                            color: colors.text,
                            backgroundColor: colors.surface,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                ))}
              <Button
                variant="secondary"
                loading={busy}
                disabled={!session || !model || !transport}
                onPress={save}
              >
                {t('saveProfile')}
              </Button>
            </View>
          )}
          <View style={styles.startArea}>
            <Button
              loading={busy}
              disabled={!availability?.enabled || !voiceTransports.length}
              onPress={() => start(Boolean(availability?.active_voice))}
            >
              {t(availability?.active_voice ? 'takeover' : 'start')}
            </Button>
            <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('consent')}</Text>
          </View>
          {availability?.active_voice && (
            <Button
              variant="ghost"
              onPress={() =>
                act(async () => {
                  if (!availability.profile || !availability.transport) return;
                  const remote = availability.active_voice!;
                  await voiceController.observe(
                    {
                      agent_session_id: session,
                      binding_version: availability.binding_version,
                      profile_id: availability.profile.profile_id,
                      profile_revision: availability.profile.revision,
                      label: title,
                      transport: availability.transport,
                    },
                    remote.voice_session_id,
                    remote.activation_epoch,
                  );
                })
              }
            >
              {t('observe')}
            </Button>
          )}
        </>
      )}
      {(active || observing || snapshot.captions.length > 0) && (
        <View
          style={[
            styles.transcript,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('captions')}</Text>
          {snapshot.captions.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('emptyCaptions')}</Text>
          ) : (
            snapshot.captions.slice(-16).map((caption) => (
              <View key={caption.id} style={styles.caption}>
                <View style={styles.captionHead}>
                  <Text
                    style={[
                      styles.speaker,
                      { color: caption.speaker === 'user' ? colors.textTertiary : colors.primary },
                    ]}
                  >
                    {t(caption.speaker)}
                  </Text>
                  <Text style={[styles.fact, { color: colors.textTertiary }]}>
                    {(caption.consumedUs ?? 0) > 0
                      ? t('played')
                      : !caption.committed
                        ? t('tentative')
                        : ''}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.captionText,
                    { color: caption.committed ? colors.text : colors.textTertiary },
                  ]}
                >
                  {caption.timingOnly
                    ? t('audioConsumptionRecord')
                    : caption.revoked
                      ? t('sourceRevoked')
                      : caption.text}
                </Text>
                {(caption.consumedUs ?? 0) > 0 && (
                  <Text style={[styles.hint, { color: colors.textTertiary }]}>
                    {t('audioTiming', {
                      seconds: ((caption.consumedUs ?? 0) / 1e6).toFixed(2),
                      precision: t(`precision.${caption.playbackPrecision ?? 'unknown'}`),
                    })}
                  </Text>
                )}
              </View>
            ))
          )}
        </View>
      )}
      {snapshot.lastReceipt && (
        <View style={[styles.receipt, { borderColor: colors.border }]}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('workReceipt')}</Text>
            <Text style={[styles.fact, { color: colors.primary }]}>
              {t(`receipt.${snapshot.lastReceipt.status}`)}
            </Text>
          </View>
          <Text style={[styles.receiptText, { color: colors.textSecondary }]}>
            {snapshot.lastReceipt.summary}
          </Text>
          {active && snapshot.lastReceipt.target && snapshot.lastReceipt.status !== 'terminal' && (
            <Button small variant="ghost" disabled={busy} onPress={stopWork}>
              {t('stopWork')}
            </Button>
          )}
        </View>
      )}
      {snapshot.approvals.map((presentation) => (
        <View
          key={presentation.target.presentation_id}
          style={[styles.notice, { backgroundColor: colors.warningSoft }]}
        >
          <Text style={[styles.sectionTitle, { color: colors.warning }]}>{t('approval')}</Text>
          <Text style={[styles.receiptText, { color: colors.text }]}>{presentation.question}</Text>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('approvalHint')}</Text>
          <Button
            small
            variant="ghost"
            onPress={() => {
              const id = snapshot.binding?.agent_session_id;
              if (id) router.push(`/session/${id}`);
            }}
          >
            {t('openSession')}
          </Button>
        </View>
      ))}
      {snapshot.device && (
        <View style={styles.audioInfo}>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t(
              snapshot.device.echo_cancellation === true
                ? 'reportedEchoOn'
                : snapshot.device.echo_cancellation === false
                  ? 'reportedEchoOff'
                  : 'reportedEchoUnknown',
            )}
          </Text>
          <View style={styles.volume}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('volume')} · {Math.round(volume * 100)}%
            </Text>
            <View style={styles.pills}>
              <Button
                small
                variant="secondary"
                disabled={volume === 0}
                onPress={() => {
                  const next = Math.max(0, volume - 0.1);
                  setVolume(next);
                  voiceController.volume(next);
                }}
              >
                −
              </Button>
              <Button
                small
                variant="secondary"
                disabled={volume >= 1}
                onPress={() => {
                  const next = Math.min(1, volume + 0.1);
                  setVolume(next);
                  voiceController.volume(next);
                }}
              >
                +
              </Button>
            </View>
          </View>
          <Button
            small
            variant="ghost"
            onPress={() =>
              act(() =>
                Share.share({ message: JSON.stringify(voiceController.getDiagnostics(), null, 2) }),
              )
            }
          >
            {t('shareObservations')}
          </Button>
        </View>
      )}
      <Text style={[styles.policy, { color: colors.textTertiary }]}>{t('backgroundPolicy')}</Text>
    </Screen>
  );
}
function State({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.state}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.stateText, { color }]}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  topline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: Spacing.md,
  },
  eyebrow: { flex: 1, minWidth: 0, fontSize: FontSize.xs, lineHeight: 17, letterSpacing: 0 },
  privateBadge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: Radius.sm,
  },
  privateText: { fontSize: FontSize.xs },
  hero: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  heroIcon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heading: { fontSize: FontSize.xl, fontWeight: '600', textAlign: 'center' },
  server: { fontSize: FontSize.xs, maxWidth: '95%' },
  statuses: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
    marginTop: 6,
  },
  state: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  stateText: { fontSize: FontSize.xs },
  level: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  levelBar: { width: 3, borderRadius: 2 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.lg,
  },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '600', marginVertical: Spacing.md },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pills: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  pill: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderRadius: Radius.md,
    maxWidth: 190,
  },
  pillText: { fontSize: FontSize.sm },
  hint: { fontSize: FontSize.xs, lineHeight: 19 },
  models: { gap: 10, marginTop: 14 },
  model: { padding: 14, borderRadius: Radius.md, borderWidth: 1 },
  modelHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modelTitle: { flex: 1, fontSize: FontSize.sm, fontWeight: '600' },
  evidence: { fontSize: FontSize.xs, lineHeight: 19, marginTop: 7 },
  startArea: { gap: 9, marginTop: Spacing.lg },
  transcript: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    marginTop: Spacing.lg,
  },
  caption: { gap: 5, paddingVertical: 10 },
  captionHead: { flexDirection: 'row', justifyContent: 'space-between' },
  speaker: { fontSize: FontSize.xs },
  fact: { fontSize: FontSize.xs },
  sourceQuote: { borderLeftWidth: 2, paddingLeft: Spacing.md, paddingVertical: Spacing.sm },
  sourceConfirm: {
    minHeight: 46,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceConfirmText: {
    width: '100%',
    flexShrink: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  },
  captionText: { fontSize: FontSize.sm, lineHeight: 22 },
  receipt: { marginTop: Spacing.md, borderTopWidth: 1 },
  receiptText: { fontSize: FontSize.sm, lineHeight: 22 },
  volume: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 8,
  },
  audioInfo: { marginTop: 16, gap: 7 },
  profileSummary: { marginTop: 10, padding: 12, borderRadius: Radius.md, gap: 5 },
  option: { gap: 8 },
  optionInput: { borderWidth: 1, borderRadius: Radius.md, padding: 11, fontSize: FontSize.sm },
  notice: { padding: Spacing.md, borderRadius: Radius.md, gap: 7, marginTop: Spacing.md },
  noticeText: { fontSize: FontSize.sm, lineHeight: 21 },
  policy: { fontSize: FontSize.xs, lineHeight: 19, marginTop: Spacing.xl, marginBottom: 84 },
});
