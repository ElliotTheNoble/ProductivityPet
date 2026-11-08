import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { getFake, putScheduled } from './notification-fake';

// Stage 4.5e: the Parent dashboard's notice that private reminders of an earlier profile could not be confirmed as cleared. It appears
// only in family mode and only while the clean-up is unverified, says nothing about any child, pet or task, has no button (a retry from
// there could cancel the open profile's own reminders), and goes away when the clean-up is verified.

jest.mock('expo-notifications', () => require('./notification-fake').createNotificationFake().module);

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
afterEach(() => {
  RNTL.cleanup();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

async function boot(options: { family?: boolean; language?: 'en' | 'es' } = {}) {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  require('expo-notifications');
  const i18n = require('@/i18n') as typeof import('@/i18n');
  i18n.setCurrentLanguage(options.language ?? 'en');
  const cleanup = require('@/utils/notification-cleanup') as typeof import('@/utils/notification-cleanup');
  cleanup.configureCleanupForTests({ canRun: () => true, setTimer: () => 0, clearTimer: () => undefined });
  const { NotificationCleanupNotice } = require('@/components/notification-cleanup-notice') as typeof import('@/components/notification-cleanup-notice');
  return { i18n, cleanup, NotificationCleanupNotice, fake: getFake() };
}
const t = (app: Awaited<ReturnType<typeof boot>>, key: Parameters<Awaited<ReturnType<typeof boot>>['i18n']['translate']>[1]) => app.i18n.translate(app.i18n.getCurrentLanguage(), key);

describe('the clean-up notice', () => {
  test('is shown while the clean-up is unverified, in English, with no child, pet or task named and no button', async () => {
    const app = await boot();
    putScheduled(app.fake, { identifier: 'mystery', content: { title: 'x', body: "Mia's secret", data: {} } });
    await app.cleanup.cleanPrivateNotifications(); // an unknown notification: unverified
    const view = await RNTL.render(ReactTop.createElement(app.NotificationCleanupNotice));
    await view.findByText('Reminders may still be on this device');
    const body = view.getByText(/couldn't confirm/);
    expect(body.props.accessibilityRole).toBe('alert');
    expect(view.queryByRole('button')).toBeNull();
    const text = JSON.stringify(view.toJSON());
    for (const secret of ['Mia', 'secret', 'mystery', 'Kitty', 'task']) expect(text).not.toContain(secret);
  });

  test('is not shown when the clean-up is verified, unsupported or has not run', async () => {
    const app = await boot();
    const view = await RNTL.render(ReactTop.createElement(app.NotificationCleanupNotice));
    expect(view.toJSON()).toBeNull(); // idle
    await RNTL.act(async () => {
      await app.cleanup.cleanPrivateNotifications();
    });
    expect(app.cleanup.getCleanupSnapshot().state).toBe('verified');
    expect(view.toJSON()).toBeNull();
  });

  test('appears when the clean-up fails and goes away when it is verified', async () => {
    const app = await boot();
    const view = await RNTL.render(ReactTop.createElement(app.NotificationCleanupNotice));
    app.fake.state.listError = new Error('down');
    await RNTL.act(async () => {
      await app.cleanup.cleanPrivateNotifications();
    });
    await view.findByText(t(app, 'ncNoticeTitle'));
    app.fake.state.listError = null;
    await RNTL.act(async () => {
      await app.cleanup.cleanPrivateNotifications();
    });
    expect(view.toJSON()).toBeNull();
  });

  test('Spanish', async () => {
    const app = await boot({ language: 'es' });
    app.fake.state.listError = new Error('down');
    await app.cleanup.cleanPrivateNotifications();
    const view = await RNTL.render(ReactTop.createElement(app.NotificationCleanupNotice));
    await view.findByText('Puede que queden recordatorios en este dispositivo');
  });

  test('never with family mode off, whatever the state', async () => {
    const app = await boot({ family: false });
    app.fake.state.listError = new Error('down');
    await app.cleanup.cleanPrivateNotifications();
    const view = await RNTL.render(ReactTop.createElement(app.NotificationCleanupNotice));
    expect(view.toJSON()).toBeNull();
  });
});
