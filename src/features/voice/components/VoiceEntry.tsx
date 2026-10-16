import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/use-theme';
/** Navigation only: entering configuration never acquires the microphone. */
export default function VoiceEntry({ session }: { session: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('voice');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('title')}
      onPress={() => router.push({ pathname: '/voice', params: { session } })}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name="mic-outline" size={21} color={colors.primary} />
    </Pressable>
  );
}
