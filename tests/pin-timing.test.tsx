import { act, render, screen } from '@testing-library/react-native';

import { DevPinTiming } from '@/components/dev-pin-timing';
import { makeSecretRecord } from '@/utils/pin-crypto';
import { getPinTiming, recordCheckTime, resetPinTimingForTests } from '@/utils/pin-timing';

// The TEMPORARY development-only PIN timing (see src/utils/pin-timing.ts): it needs a development build with family mode on, which
// this file switches on for itself. It must record only durations, never anything about a PIN, and do nothing otherwise.

jest.mock('@/utils/dev-flags', () => ({ ...jest.requireActual('@/utils/dev-flags'), FAMILY_MODE_ENABLED: true }));

const CHEAP = { alg: 'scrypt' as const, N: 1024, r: 8, p: 1, dkLen: 32 as const };

beforeEach(() => resetPinTimingForTests());

test('the scrypt step and the whole check are recorded, with nothing but numbers', async () => {
  const secret = '48291736';
  await makeSecretRecord('pin', secret, undefined, CHEAP);
  recordCheckTime(1234.4);
  const timing = getPinTiming();
  expect(timing.deriveMs).toEqual(expect.any(Number));
  expect(timing.n).toBe(1024);
  expect(timing.totalMs).toBe(1234);
  expect(timing.checks).toBe(1);
  expect(JSON.stringify(timing)).not.toContain(secret);
  expect(Object.keys(timing).sort()).toEqual(['checks', 'deriveMs', 'n', 'totalMs']);
});

test('the development line shows the numbers, and nothing before the first check', async () => {
  await render(<DevPinTiming />);
  expect(screen.queryByText(/DEV timing/, { includeHiddenElements: true })).toBeNull();
  await makeSecretRecord('pin', '4829', undefined, CHEAP);
  await act(async () => recordCheckTime(800));
  expect(screen.getByText(/DEV timing, check #1: 800 ms in total, of which the scrypt step \d+ ms \(N=1024\)/, { includeHiddenElements: true })).toBeTruthy();
});

test('nothing is recorded or shown in a build that is not a development build with family mode on', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve('src/utils/pin-timing.ts'), 'utf8');
  expect(src).toMatch(/__DEV__ && FAMILY_MODE_ENABLED/);
  expect(src.match(/if \(!pinTimingEnabled\(\)\) return;/g)).toHaveLength(2);
  const view = fs.readFileSync(path.resolve('src/components/dev-pin-timing.tsx'), 'utf8');
  expect(view).toMatch(/!pinTimingEnabled\(\)/);
  expect(src + view).not.toMatch(/console\./);
});
