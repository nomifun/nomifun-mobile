import { useMemo, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen, toast } from '@/components/ui';
import { createRequirement } from '@/features/requirements/api';
import { RequirementForm } from '@/features/requirements/components/requirement-form';
import { useInvalidateRequirements, useRequirementTags } from '@/features/requirements/hooks';

export default function NewRequirementScreen() {
  const { t } = useTranslation('requirements');
  const { t: tc } = useTranslation('common');
  const { tag: presetTag } = useLocalSearchParams<{ tag?: string }>();

  const tags = useRequirementTags();
  const invalidate = useInvalidateRequirements();
  const [submitting, setSubmitting] = useState(false);

  // Busiest queues first — the tag IS the queue, so recency of use matters.
  const suggestions = useMemo(
    () =>
      (tags.data ?? [])
        .slice()
        .sort((a, b) => b.total - a.total)
        .map((summary) => summary.tag),
    [tags.data],
  );

  const submit = async (values: { title: string; tag: string; content: string }) => {
    setSubmitting(true);
    try {
      await createRequirement({ title: values.title, tag: values.tag, content: values.content });
      invalidate();
      toast.success(t('form.created'));
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc('feedback.requestFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen keyboardAvoiding>
      <Stack.Screen options={{ title: t('form.createTitle') }} />
      <RequirementForm
        initial={{ title: '', tag: presetTag ?? '', content: '' }}
        tagSuggestions={suggestions}
        submitting={submitting}
        submitLabel={t('form.submit')}
        hint={t('form.createHint')}
        autoFocus
        onSubmit={(values) => void submit(values)}
      />
    </Screen>
  );
}
