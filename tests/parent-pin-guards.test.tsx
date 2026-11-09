import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';

import ParentSecurityPage from '@/app/parent-security';
import { ParentPinCard } from '@/components/parent-pin-card';
import { parentPinEn } from '@/i18n/parent-pin.en';
import { parentPinEs } from '@/i18n/parent-pin.es';
import { setCurrentLanguage, translate } from '@/i18n';
import { selectNativeAuthBackend, isDevAuthPreview } from '@/utils/parent-auth-backend';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { hasPinVerifier, lockParentArea } from '@/utils/parent-gate';

import { resetSecure, secureTest } from './helpers';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: ({ href }: { href: string }) => require('react').createElement(require('react-native').Text, null, `REDIRECT:${href}`),
}));

const fs = require('fs');
const path = require('path');
const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const en = (key: Parameters<typeof translate>[1]) => translate('en', key);

beforeEach(() => {
  setCurrentLanguage('en');
  mockRouter.push.mockClear();
});

// These run before anything registers a PIN checker: they describe every install while family mode is off.
describe('family mode off (the committed default and every release build)', () => {
  test('the flag is off here, and its expression needs both a development build and the explicit environment variable', () => {
    expect(FAMILY_MODE_ENABLED).toBe(false);
    const src = read('src/utils/dev-flags.ts');
    expect(src).toMatch(/FAMILY_MODE_ENABLED: boolean = __DEV__ && process\.env\.EXPO_PUBLIC_FAMILY_MODE === '1'/);
  });

  test('the flag cannot be on in a production build even if the variable is set; it is on only with both', () => {
    const original = process.env.EXPO_PUBLIC_FAMILY_MODE;
    const g = globalThis as unknown as { __DEV__: boolean };
    const evaluate = (dev: boolean, env: string | undefined) => {
      g.__DEV__ = dev;
      if (env === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
      else process.env.EXPO_PUBLIC_FAMILY_MODE = env;
      let value = false;
      jest.isolateModules(() => {
        value = (require('@/utils/dev-flags') as { FAMILY_MODE_ENABLED: boolean }).FAMILY_MODE_ENABLED;
      });
      return value;
    };
    try {
      expect(evaluate(true, '1')).toBe(true);
      expect(evaluate(false, '1')).toBe(false); // a production build
      expect(evaluate(true, undefined)).toBe(false);
      expect(evaluate(true, '0')).toBe(false);
      expect(evaluate(true, 'true')).toBe(false);
    } finally {
      g.__DEV__ = true;
      if (original === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
      else process.env.EXPO_PUBLIC_FAMILY_MODE = original;
    }
  });

  test('no PIN checker is registered and the /parent-security route just goes back to the app (no PIN screen)', async () => {
    expect(hasPinVerifier()).toBe(false);
    await render(<ParentSecurityPage />);
    expect(screen.toJSON()).toEqual(expect.objectContaining({ children: ['REDIRECT:/'] }));
  });

  test('the dashboard card renders nothing', async () => {
    await render(<ParentPinCard />);
    expect(screen.toJSON()).toBeNull();
  });

  test('startParentAuth does nothing and loads no secure-storage code when the flag is off', () => {
    const { startParentAuth } = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
    expect(startParentAuth({ enabled: false })).toBe(false);
    expect(hasPinVerifier()).toBe(false);
    expect(secureTest().loaded).toBe(0);
  });
});

describe('the web (no secure storage)', () => {
  const { startParentAuth, beginPinSetup } = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');

  afterEach(() => {
    selectNativeAuthBackend();
    lockParentArea();
  });

  test('a production web build never offers a PIN: nothing is registered', () => {
    expect(startParentAuth({ enabled: true, platformOS: 'web', devPreview: false })).toBe(false);
    expect(hasPinVerifier()).toBe(false);
    expect(isDevAuthPreview()).toBe(false);
  });

  test('the development preview is in memory only: it writes to neither secure storage nor AsyncStorage', async () => {
    resetSecure();
    await AsyncStorage.clear();
    expect(startParentAuth({ enabled: true, platformOS: 'web', devPreview: true })).toBe(true);
    expect(isDevAuthPreview()).toBe(true);
    const begun = await beginPinSetup('135792');
    expect(begun.ok).toBe(true);
    expect(secureTest().sets).toEqual([]);
    expect([...secureTest().map.keys()]).toEqual([]);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  test('the preview module imports no storage at all', () => {
    const src = code('src/utils/parent-auth-preview.ts');
    expect(src).not.toMatch(/AsyncStorage|expo-secure-store|parent-secrets|localStorage|sessionStorage|indexedDB/);
  });
});

describe('English and Spanish text', () => {
  const keys = Object.keys(parentPinEn) as (keyof typeof parentPinEn)[];
  const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');

  test('every key exists in both languages, none is empty, and the placeholders match', () => {
    expect(Object.keys(parentPinEs).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(parentPinEn[key].trim()).not.toBe('');
      expect(parentPinEs[key].trim()).not.toBe('');
      expect(placeholders(parentPinEs[key])).toBe(placeholders(parentPinEn[key]));
    }
  });

  test('Spanish is really translated (not a copy of the English) except for names and codes', () => {
    const same = keys.filter((k) => parentPinEs[k] === parentPinEn[k]);
    expect(same).toEqual(expect.arrayContaining([]));
    expect(same.filter((k) => /[a-z]{4,}/.test(parentPinEn[k].replace(/\{[a-zA-Z]+\}/g, '')) && k !== 'rcFieldPlaceholder')).toEqual([]);
  });

  test('the wording never claims the PIN verifies who is a parent or that it is secure', () => {
    const all = keys.map((k) => parentPinEn[k]).join('\n').toLowerCase();
    expect(all).not.toMatch(/verif(y|ied|ies) (that )?you|proves? (you are|you're) (a|the) parent|unbreakable|hack-?proof|100% secure|completely secure/);
    expect(all).toMatch(/does not prove|doesn't prove|not prove/);
  });

  test('the code screens warn against screenshots and keep "the app cannot show it again"', () => {
    expect(en('psCodeNoShot')).toMatch(/screenshot/i);
    expect(en('psCodeBody')).toMatch(/cannot show it again/i);
  });

  test('no string contains a digit sequence that could be mistaken for a sample PIN', () => {
    // (the one allowed example is the obviously weak 123456 in the weak-PIN message)
    for (const key of keys) expect(parentPinEn[key].replace('123456', '')).not.toMatch(/\d{4,}/);
    for (const key of keys) expect(parentPinEs[key].replace('123456', '')).not.toMatch(/\d{4,}/);
  });
});

describe('static checks on the PIN screens', () => {
  const files = [
    'src/components/pin-entry.tsx',
    'src/components/recovery-code.tsx',
    'src/components/parent-pin-flows.tsx',
    'src/components/parent-recovery-gate.tsx',
    'src/components/parent-security-screen.tsx',
    'src/components/parent-pin-card.tsx',
    'src/components/parent-gate.tsx',
    'src/hooks/use-sensitive-screen.ts',
    'src/hooks/use-parent-auth-status.ts',
    'src/app/parent-security.tsx',
  ];

  test.each(files)('%s never logs, stores, copies or puts anything in a route or link', (file) => {
    const src = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/);
    expect(src).not.toMatch(/AsyncStorage|localStorage|sessionStorage|SecureStore|setItem|expo-clipboard|Share\.share|Linking/);
    // (copying and pasting go only through @/utils/clipboard, see the clipboard checks below)
    expect(src).not.toMatch(/router\.(push|replace|navigate)\(\s*[`{][^)]*(pin|code)/i);
    expect(src).not.toMatch(/useLocalSearchParams|useGlobalSearchParams|searchParams/);
  });

  test.each(files)('%s has no hard-coded English words in JSX or labels (text comes from the catalog)', (file) => {
    const src = read(file);
    const literalText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z' ,.?!-]{2,})\s*</g)].map((m) => m[1]).filter((s) => /[a-z]{3,}/.test(s));
    expect(literalText).toEqual([]);
    const literalProps = [...src.matchAll(/(?:label|accessibilityLabel|accessibilityHint|title|placeholder)="([^"]*[A-Za-z]{3,}[^"]*)"/g)].map((m) => m[1]);
    expect(literalProps).toEqual([]);
  });

  test('the number pad and hardware field are the only places a PIN is held, and neither keeps it beyond props', () => {
    const src = read('src/components/pin-entry.tsx');
    expect(src).toMatch(/secureTextEntry/);
    expect(src).toMatch(/autoComplete="off"/);
    expect(src).toMatch(/importantForAutofill="noExcludeDescendants"/);
    expect(src).not.toMatch(/useRef<string|useRef\(''\)/);
  });

  test('the recovery code is selectable-off; copying is a button that asks first and only works while the code is shown', () => {
    const src = code('src/components/recovery-code.tsx');
    expect(src).toMatch(/selectable=\{false\}/);
    // copyText is called in exactly one place (after the warning is confirmed) and never from an effect
    expect(src.match(/copyText\(/g)).toHaveLength(1);
    expect(src).toMatch(/onConfirm=\{\(\) => void copy\(\)\}/);
    expect(src).not.toMatch(/useEffect\([^)]*copyText/);
    expect(src).not.toMatch(/expo-clipboard/);
  });

  test('only @/utils/clipboard touches expo-clipboard, and it keeps and logs nothing', () => {
    const offenders = ['src/components', 'src/hooks', 'src/utils', 'src/app']
      .flatMap((dir) => require('fs').readdirSync(require('path').resolve(dir)).map((f: string) => `${dir}/${f}`))
      .filter((f: string) => /\.(ts|tsx)$/.test(f) && f !== 'src/utils/clipboard.ts')
      .filter((f: string) => /expo-clipboard/.test(read(f)));
    expect(offenders).toEqual([]);
    const util = code('src/utils/clipboard.ts');
    expect(util).not.toMatch(/console\.|AsyncStorage|SecureStore|setItem/);
  });

  test('screen capture protection is requested by the sensitive screen hook and released when it closes', () => {
    const src = read('src/hooks/use-sensitive-screen.ts');
    expect(src).toMatch(/preventScreenCaptureAsync/);
    expect(src).toMatch(/allowScreenCaptureAsync/);
    expect(src).toMatch(/enableAppSwitcherProtectionAsync/);
    expect(src).toMatch(/disableAppSwitcherProtectionAsync/);
  });
});
