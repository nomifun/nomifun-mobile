import { useTranslation } from 'react-i18next';
import { useAppNavigation } from '@/hooks/use-app-navigation';
import { IconButton } from '@/components/ui/icon-button';

export function AppMenuButton() {
  const navigation = useAppNavigation();
  const { t } = useTranslation('common');
  return navigation && !navigation.permanent ? (
    <IconButton icon="menu-outline" label={t('navigation.open')} onPress={navigation.open} />
  ) : null;
}
