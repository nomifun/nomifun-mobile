import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

export interface RequirementFormValues {
  title: string;
  tag: string;
  content: string;
}

interface RequirementFormProps {
  initial: RequirementFormValues;
  /** Existing tags, most-used first — a tag is just a queue name. */
  tagSuggestions?: string[];
  submitting?: boolean;
  submitLabel: string;
  hint?: string;
  autoFocus?: boolean;
  onSubmit: (values: RequirementFormValues) => void;
  onCancel?: () => void;
}

/** Create/edit form for a requirement: title + tag (both required) + content. */
export function RequirementForm({
  initial,
  tagSuggestions,
  submitting,
  submitLabel,
  hint,
  autoFocus,
  onSubmit,
  onCancel,
}: RequirementFormProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const { t: tc } = useTranslation('common');

  const [title, setTitle] = useState(initial.title);
  const [tag, setTag] = useState(initial.tag);
  const [content, setContent] = useState(initial.content);
  const [errors, setErrors] = useState<{ title?: string; tag?: string }>({});

  const submit = () => {
    const next: { title?: string; tag?: string } = {};
    if (title.trim() === '') next.title = t('form.titleRequired');
    if (tag.trim() === '') next.tag = t('form.tagRequired');
    setErrors(next);
    if (next.title || next.tag) return;
    onSubmit({ title: title.trim(), tag: tag.trim(), content });
  };

  return (
    <View>
      <TextField
        label={t('form.titleLabel')}
        placeholder={t('form.titlePlaceholder')}
        value={title}
        error={errors.title}
        autoFocus={autoFocus}
        autoCapitalize="sentences"
        onChangeText={(next) => {
          setTitle(next);
          if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
        }}
      />

      <TextField
        label={t('form.tagLabel')}
        placeholder={t('form.tagPlaceholder')}
        hint={t('form.tagHint')}
        value={tag}
        error={errors.tag}
        onChangeText={(next) => {
          setTag(next);
          if (errors.tag) setErrors((prev) => ({ ...prev, tag: undefined }));
        }}
      />

      {tagSuggestions && tagSuggestions.length > 0 ? (
        <View style={styles.suggestions}>
          <Text style={[styles.suggestionsLabel, { color: colors.textTertiary }]}>
            {t('form.tagSuggestions')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {tagSuggestions.map((option) => {
              const active = option === tag.trim();
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  {...a11yState({ selected: active })}
                  onPress={() => {
                    setTag(option);
                    if (errors.tag) setErrors((prev) => ({ ...prev, tag: undefined }));
                  }}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primarySoft : colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipLabel,
                      { color: active ? colors.primary : colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <TextField
        label={t('form.contentLabel')}
        placeholder={t('form.contentPlaceholder')}
        hint={t('form.contentHint')}
        value={content}
        onChangeText={setContent}
        multiline
        autoCapitalize="sentences"
        style={styles.multiline}
      />

      {hint ? <Text style={[styles.hint, { color: colors.textTertiary }]}>{hint}</Text> : null}

      <Button onPress={submit} loading={submitting}>
        {submitLabel}
      </Button>
      {onCancel ? (
        <Button variant="ghost" onPress={onCancel} disabled={submitting} style={styles.cancel}>
          {tc('actions.cancel')}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestions: { marginTop: -Spacing.sm, marginBottom: Spacing.lg, gap: Spacing.sm },
  suggestionsLabel: { fontSize: FontSize.xs, fontWeight: '600' },
  chips: { gap: Spacing.sm, paddingRight: Spacing.lg },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  chipLabel: { fontSize: FontSize.sm, fontWeight: '600' },
  multiline: { minHeight: 150, paddingTop: Spacing.md, textAlignVertical: 'top' },
  hint: { fontSize: FontSize.xs, lineHeight: 18, marginBottom: Spacing.md },
  cancel: { marginTop: Spacing.sm },
});
