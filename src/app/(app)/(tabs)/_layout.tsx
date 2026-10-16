import { Tabs } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Keep route state and deep links, but navigation now belongs to the app drawer. */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        initialRouteName="index"
        tabBar={() => null}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="tasks" />
        <Tabs.Screen name="requirements" />
        <Tabs.Screen name="companions" />
        <Tabs.Screen name="more" />
      </Tabs>
    </SafeAreaView>
  );
}
