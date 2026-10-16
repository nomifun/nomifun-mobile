import { expect, test } from 'bun:test';
import { modelDisplayLabel, modelPresentationRawId, modelRefLabel, providerModelRefLabel } from './presentation';

test('friendly model labels preserve opaque runtime ids and handle missing rows', () => {
  const providers = [{ provider_id: 'p', name: '服务商', models: [{ model: 'deployment-123', display_name: '主力模型' }] }];
  const ref = { provider_id: 'p', model: 'deployment-123' };
  expect(modelRefLabel(providers, ref)).toBe('主力模型');
  expect(providerModelRefLabel(providers, ref)).toBe('服务商 · 主力模型');
  expect(modelRefLabel(undefined, ref)).toBe('deployment-123');
  expect(modelRefLabel(providers, { ...ref, model: 'deleted' })).toBe('deleted');
  expect(modelRefLabel(providers, null)).toBeUndefined();
  expect(ref.model).toBe('deployment-123');
  expect(modelDisplayLabel('id', '  ')).toBe('id');
  expect(modelPresentationRawId('id', 'id')).toBeUndefined();
  expect(modelPresentationRawId('id', '  Friendly ')).toBe('id');
});
