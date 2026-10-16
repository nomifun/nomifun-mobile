import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVoice, voiceController } from '../runtime';

export default function VoiceDock() {
  const snapshot = useVoice();
  const path = usePathname();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('voice');
  const insets = useSafeAreaInsets();
  if (
    !snapshot.binding ||
    path.endsWith('/voice') ||
    !['opening', 'ready', 'recovering', 'closing'].includes(snapshot.connection)
  )
    return null;
  return (
    <View
      style={[
        styles.position,
        { paddingBottom: Math.max(insets.bottom, Spacing.sm), backgroundColor: colors.background },
      ]}
    >
      <View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('openBoundVoice')}
          onPress={() => router.push('/voice')}
          style={styles.identity}
        >
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="mic-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.copy}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
              {snapshot.binding.label}
            </Text>
            <Text style={[styles.status, { color: colors.textTertiary }]}>
              {t(
                snapshot.role === 'observer'
                  ? 'observer'
                  : snapshot.sourceContextRequirement
                    ? 'sourceContextTitle'
                    : snapshot.connection !== 'ready'
                      ? `connection.${snapshot.connection}`
                      : `microphone.${snapshot.microphone}`,
              )}
            </Text>
          </View>
        </Pressable>
        {snapshot.role === 'active' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('stopSpeaking')}
            onPress={() => void voiceController.stopSpeaking()}
            style={styles.control}
          >
            <Ionicons name="pause-outline" size={19} color={colors.textSecondary} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(snapshot.role === 'observer' ? 'stopObserving' : 'end')}
          onPress={() => void voiceController.end()}
          style={styles.control}
        >
          <Ionicons name="close-outline" size={21} color={colors.textTertiary} />
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  position: {
    flexShrink: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    alignItems: 'center',
  },
  dock: {
    width: '100%',
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: 8,
    elevation: 4,
  },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 3 },
  name: { fontSize: FontSize.sm, fontWeight: '600' },
  status: { fontSize: FontSize.xs },
  control: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
});
