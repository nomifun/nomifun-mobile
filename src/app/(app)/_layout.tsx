import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { FontSize, FontWeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AppNavigation } from '@/components/app-navigation';
import { AppMenuButton } from '@/components/app-menu-button';

/** Layout for every authenticated screen; feature detail routes live here. */
export default function AppLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation('common');

  return (
    <AppNavigation>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontSize: FontSize.title,
            fontWeight: FontWeight.heading,
          },
          headerShadowVisible: false,
          headerBackTitle: t('actions.back'),
          headerRight: () => <AppMenuButton />,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </AppNavigation>
  );
}
