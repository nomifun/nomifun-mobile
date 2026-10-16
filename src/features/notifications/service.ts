/**
 * Completion notifications — the mobile-side enhancement over the desktop.
 *
 * Listens on the realtime channel and raises a LOCAL notification when the
 * app is not in the foreground:
 *   - turn.completed        → chat reply finished (or errored)
 *   - cron.job-executed     → scheduled task ran (success/failure)
 *   - requirement.statusChanged → requirement reached done/failed
 *
 * Native uses expo-notifications; web uses the Notification API. Everything
 * is best-effort: missing permission or an unknown payload shape must never
 * throw into the WS dispatch path.
 */
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from '@/i18n';
import { nomifunSocket } from '@/api/ws';

const ENABLED_KEY = 'nomifun.notifications.enabled';

let enabled = true;
let started = false;
const offs: Array<() => void> = [];

type AnyRecord = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function appIsForeground(): boolean {
  if (Platform.OS === 'web') {
    return typeof document !== 'undefined' && document.visibilityState === 'visible';
  }
  return AppState.currentState === 'active';
}

async function presentNative(title: string, body: string, data: AnyRecord) {
  const Notifications = await import('expo-notifications');
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null,
  });
}

function presentWeb(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    // Some browsers require a service worker; silently skip.
  }
}

function notify(title: string, body: string, data: AnyRecord = {}) {
  if (!enabled || appIsForeground()) return;
  if (Platform.OS === 'web') presentWeb(title, body);
  else void presentNative(title, body, data).catch(() => undefined);
}

function onTurnCompleted(raw: unknown) {
  const d = (raw ?? {}) as AnyRecord;
  const conversationId = str(d.conversation_id);
  const name =
    str((d.last_message as AnyRecord | undefined)?.conversation_name) ||
    str(d.conversation_name) ||
    str(d.name) ||
    i18n.t('tabs.sessions', { ns: 'common' });
  const state = str(d.state) || str((d.runtime as AnyRecord | undefined)?.state);
  const t = (k: string) => i18n.t(k, { ns: 'notifications', name });
  if (state === 'error') notify(t('sessionError'), t('sessionErrorBody'), { conversationId });
  else notify(t('sessionDone'), t('sessionDoneBody'), { conversationId });
}

function onCronExecuted(raw: unknown) {
  const d = (raw ?? {}) as AnyRecord;
  const job = (d.job as AnyRecord | undefined) ?? d;
  const name = str(job.name) || str(job.description) || str(d.cron_job_id) || 'cron';
  const failed =
    d.success === false || job.success === false || /fail|error/i.test(str(d.status) + str(job.last_run_status));
  const t = (k: string) => i18n.t(k, { ns: 'notifications', name });
  if (failed) notify(t('taskFailed'), t('taskFailedBody'));
  else notify(t('taskDone'), t('taskDoneBody'));
}

function onRequirementChanged(raw: unknown) {
  const d = (raw ?? {}) as AnyRecord;
  const req = (d.requirement as AnyRecord | undefined) ?? d;
  const status = str(d.status) || str(req.status);
  if (status !== 'done' && status !== 'failed') return;
  const name = str(req.title) || str(d.requirement_id) || '';
  const t = (k: string) => i18n.t(k, { ns: 'notifications', name });
  if (status === 'failed') notify(t('requirementFailed'), t('requirementFailedBody'));
  else notify(t('requirementDone'), t('requirementDoneBody'));
}

export const notificationService = {
  async start() {
    if (started) return;
    started = true;
    enabled = (await AsyncStorage.getItem(ENABLED_KEY)) !== 'false';
    if (Platform.OS !== 'web') {
      const Notifications = await import('expo-notifications');
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    }
    offs.push(nomifunSocket.on('turn.completed', onTurnCompleted));
    offs.push(nomifunSocket.on('cron.job-executed', onCronExecuted));
    offs.push(nomifunSocket.on('requirement.statusChanged', onRequirementChanged));
  },

  stop() {
    for (const off of offs.splice(0)) off();
    started = false;
  },

  isEnabled(): boolean {
    return enabled;
  },

  /** Toggle; returns the effective value (false if permission was denied). */
  async setEnabled(next: boolean): Promise<boolean> {
    if (next) {
      const granted = await this.requestPermission();
      if (!granted) next = false;
    }
    enabled = next;
    await AsyncStorage.setItem(ENABLED_KEY, String(next));
    return next;
  },

  async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'web') {
      if (typeof Notification === 'undefined') return false;
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      return (await Notification.requestPermission()) === 'granted';
    }
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  },
};
