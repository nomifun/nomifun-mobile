/** One companion on the roster: figure, name, persona snippet and live badges. */
import { useTranslation } from 'react-i18next';

import { Tag } from '@/components/ui';
import { ProfileTile } from '@/components/codevisual/profile-tile';

import type { CompanionWithStatus } from '../types';
import { MOOD_VISUALS, characterOf, levelNameKey, levelOf, moodOf } from '../utils';
import { CompanionFigure } from './companion-figure';

export function CompanionCard({
  companion,
  isDefault,
  onPress,
}: {
  companion: CompanionWithStatus;
  isDefault: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation('companions');

  const status = companion.status;
  const mood = moodOf(status?.mood);
  const { level } = levelOf(status?.xp ?? 0);
  const character = characterOf(companion.character);
  const snippet = companion.persona?.custom?.trim() || t(`characters.${character}.style`) || '';

  return (
    <ProfileTile
      name={companion.name}
      subtitle={snippet}
      onPress={onPress}
      figure={<CompanionFigure companion={companion} size={48} mood={status?.mood} />}
      badge={isDefault ? <Tag tone="primary">{t('roster.default')}</Tag> : undefined}
      metadata={
        <>
          <Tag tone={MOOD_VISUALS[mood].tone}>{t(`moods.${mood}`)}</Tag>
          <Tag>{t('card.level', { level, name: t(levelNameKey(level)) })}</Tag>
          <Tag>{t('card.memories', { count: status?.memories_active ?? 0 })}</Tag>
          {status && !status.model_configured ? (
            <Tag tone="warning">{t('card.modelMissing')}</Tag>
          ) : null}
        </>
      }
    />
  );
}
