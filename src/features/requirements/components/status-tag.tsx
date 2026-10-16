import { useTranslation } from 'react-i18next';

import { Tag } from '@/components/ui';

import { STATUS_TONE, type RequirementStatus } from '../types';

/** Status chip with the platform's canonical tone per status. */
export function StatusTag({ status }: { status: RequirementStatus }) {
  const { t } = useTranslation('requirements');
  return <Tag tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Tag>;
}

/** Localised status label (for buttons / sentences). */
export function useStatusLabel(): (status: RequirementStatus) => string {
  const { t } = useTranslation('requirements');
  return (status: RequirementStatus) => t(`status.${status}`);
}
