import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/components/ui';

export default function PlaceholderScreen() {
  const { t } = useTranslation('common');
  return (
    <Screen scroll={false}>
      <EmptyState icon="construct-outline" title={t('state.loading')} />
    </Screen>
  );
}
