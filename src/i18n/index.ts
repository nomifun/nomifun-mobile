import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en-US/common.json';
import enCompanions from './locales/en-US/companions.json';
import enConnect from './locales/en-US/connect.json';
import enCustomerService from './locales/en-US/customerService.json';
import enModels from './locales/en-US/models.json';
import enNotifications from './locales/en-US/notifications.json';
import enRequirements from './locales/en-US/requirements.json';
import enSessions from './locales/en-US/sessions.json';
import enSettings from './locales/en-US/settings.json';
import enTasks from './locales/en-US/tasks.json';
import zhCommon from './locales/zh-CN/common.json';
import zhCompanions from './locales/zh-CN/companions.json';
import zhConnect from './locales/zh-CN/connect.json';
import zhCustomerService from './locales/zh-CN/customerService.json';
import zhModels from './locales/zh-CN/models.json';
import zhNotifications from './locales/zh-CN/notifications.json';
import zhRequirements from './locales/zh-CN/requirements.json';
import zhSessions from './locales/zh-CN/sessions.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhTasks from './locales/zh-CN/tasks.json';

export const NAMESPACES = [
  'common',
  'connect',
  'sessions',
  'tasks',
  'requirements',
  'companions',
  'models',
  'customerService',
  'settings',
  'notifications',
] as const;

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      common: zhCommon,
      connect: zhConnect,
      sessions: zhSessions,
      tasks: zhTasks,
      requirements: zhRequirements,
      companions: zhCompanions,
      models: zhModels,
      customerService: zhCustomerService,
      settings: zhSettings,
      notifications: zhNotifications,
    },
    'en-US': {
      common: enCommon,
      connect: enConnect,
      sessions: enSessions,
      tasks: enTasks,
      requirements: enRequirements,
      companions: enCompanions,
      models: enModels,
      customerService: enCustomerService,
      settings: enSettings,
      notifications: enNotifications,
    },
  },
  lng: 'zh-CN',
  fallbackLng: ['zh-CN', 'en-US'],
  defaultNS: 'common',
  ns: [...NAMESPACES],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
