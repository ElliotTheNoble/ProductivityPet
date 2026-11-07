import { PROTECTED_PREFIX } from '@/utils/storage-fence';

// Stage 4.4b: the audit of every place that can change ProductivityPet storage. The storage fence (src/utils/storage-fence.ts) wraps
// the one AsyncStorage object every module imports, so it covers every write below without each of them being edited. THIS test is
// what proves the list is complete and keeps it complete: a new write path, a new way of reaching storage, or a key outside the
// protected prefix makes it fail, with a message saying what to check. It reads the source, so it cannot be fooled by a test double.

const fs = require('fs');
const path = require('path');

function sources(dir = 'src'): { file: string; code: string; raw: string }[] {
  const out: { file: string; code: string; raw: string }[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const raw = fs.readFileSync(full, 'utf8') as string;
        out.push({ file: full.split(path.sep).join('/'), raw, code: raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1') });
      }
    }
  };
  walk(path.resolve(dir));
  const root = path.resolve('.');
  return out.map((s) => ({ ...s, file: path.relative(root, s.file).split(path.sep).join('/') }));
}
const ALL = sources();

const MUTATORS = '(setItem|multiSet|mergeItem|multiMerge|removeItem|multiRemove|clear)';

// Every place in src that changes AsyncStorage today, with how many calls each file has. (These are ALL the protected write paths.)
const WRITE_PATHS: Record<string, number> = {
  'src/utils/profiles.ts': 5, //            writeScoped (all profile and Main data), the pre-profile backup, the registry's corrupt-copy, its first write, writeRegistry
  'src/utils/household.ts': 2, //           the household's safety copy of an unreadable entry, and the household write itself
  'src/utils/onboarding.ts': 1, //          the onboarding record
  'src/utils/parent-gate.ts': 1, //         the parent guess counter (when it is kept in AsyncStorage)
  'src/utils/parent-auth-backend.ts': 1, // the PIN marker
  'src/utils/paw-tokens.ts': 1, //          the awarded-keys safety copy
  'src/utils/pet-family.ts': 1, //          the pet-family safety copy
  'src/utils/dev-stage-preview.ts': 1, //   a development-tool key
};

describe('every ProductivityPet storage write path is known', () => {
  test('the AsyncStorage calls that change data are exactly the known ones (a new one fails here until it is checked and added)', () => {
    const found: Record<string, number> = {};
    for (const { file, code } of ALL) {
      const count = (code.match(new RegExp(`\\bAsyncStorage\\s*\\.\\s*${MUTATORS}\\b`, 'g')) ?? []).length;
      if (count > 0) found[file] = count;
    }
    expect(found).toEqual(WRITE_PATHS);
  });

  test('AsyncStorage is only ever used by name with a known method: never passed around, aliased, destructured or indexed', () => {
    const ok = new RegExp(`\\bAsyncStorage\\s*\\.\\s*(getItem|getAllKeys|multiGet|${MUTATORS.slice(1, -1)})\\b`);
    const offenders: string[] = [];
    for (const { file, code } of ALL) {
      if (file === 'src/utils/storage-fence.ts') continue; // the fence itself (it reaches the object to wrap it)
      for (const line of code.split('\n')) {
        if (!/\bAsyncStorage\b/.test(line) || /^\s*import\s/.test(line)) continue;
        // every use on the line must be a known method call
        const stripped = line.replace(new RegExp(ok.source, 'g'), '');
        if (/\bAsyncStorage\b/.test(stripped)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('AsyncStorage is only imported as the default export, never required or re-exported (except by the fence)', () => {
    const offenders: string[] = [];
    for (const { file, code } of ALL) {
      for (const line of code.split('\n')) {
        if (!line.includes('@react-native-async-storage/async-storage')) continue;
        if (/^\s*import AsyncStorage from '@react-native-async-storage\/async-storage';\s*$/.test(line)) continue;
        if (file === 'src/utils/storage-fence.ts') continue;
        offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no other way of storing data exists in src: no direct localStorage, sessionStorage, IndexedDB, cookies or caches (only the lock\'s own probe)', () => {
    const offenders: string[] = [];
    for (const { file, code } of ALL) {
      const matches = code.match(/\b(localStorage|sessionStorage|indexedDB|openDatabase|window\.caches|caches\.open)\b|document\.cookie/g) ?? [];
      if (matches.length > 0 && file !== 'src/utils/web-tab-lock.ts') offenders.push(`${file}: ${matches.join(', ')}`);
    }
    expect(offenders).toEqual([]);
    const lock = ALL.find((s) => s.file === 'src/utils/web-tab-lock.ts')!;
    expect(lock.code.match(/\blocalStorage\b/g)).toHaveLength(2); // the probe: one write and one removal of a key that is not a family key
    expect(lock.code).toContain('__productivitypet_storage_probe__');
  });

  test('secure storage is reached only through the parent secrets module, which has no web storage at all', () => {
    const users = ALL.filter(({ code }) => /expo-secure-store/.test(code)).map((s) => s.file);
    expect(users).toEqual(['src/utils/parent-secrets.ts']);
  });

  test('no other storage library is used', () => {
    const libraries = /react-native-mmkv|expo-sqlite|@react-native-community\/async-storage|react-native-keychain|idb-keyval|localforage|redux-persist/;
    expect(ALL.filter(({ code }) => libraries.test(code)).map((s) => s.file)).toEqual([]);
  });

  test('every key written through a literal name starts with the protected prefix', () => {
    const offenders: string[] = [];
    for (const { file, code } of ALL) {
      for (const match of code.matchAll(new RegExp(`\\bAsyncStorage\\s*\\.\\s*(setItem|mergeItem|removeItem)\\(\\s*(['"\`])([^'"\`$]+)\\2`, 'g'))) {
        if (!match[3].startsWith(PROTECTED_PREFIX)) offenders.push(`${file}: ${match[3]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every storage key constant in the storage modules starts with the protected prefix (or is a scoped name built by the profile layer)', () => {
    const offenders: string[] = [];
    for (const { file, code } of ALL) {
      if (!Object.keys(WRITE_PATHS).includes(file) && !/^src\/utils\/(pet-alerts|journal|mood-log|shop-inventory|task-storage|token-history|kitty-catch-rewards|memory-match-rewards|pawadise-mail|pawadise-postcards)\.ts$/.test(file)) continue;
      for (const match of code.matchAll(/\bconst\s+([A-Z_]*KEY[A-Z_]*)\s*(?::\s*string)?\s*=\s*(['"`])([^'"`]+)\2/g)) {
        const [, name, , value] = match;
        const scopedName = /_NAME$/.test(name); // built into '@ProductivityPet:p:<id>:<name>' (or the Main key) by the profile layer
        const fromPrefix = file === 'src/utils/profiles.ts' && value.startsWith('${PREFIX}'); // PREFIX is checked in the next test
        if (!scopedName && !fromPrefix && !value.startsWith(PROTECTED_PREFIX)) offenders.push(`${file}: ${name} = ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the profile layer builds every scoped and Main key from the protected prefix', () => {
    const profiles = ALL.find((s) => s.file === 'src/utils/profiles.ts')!;
    expect(profiles.code).toMatch(/const PREFIX = '@ProductivityPet:';/);
    expect(profiles.code).toMatch(/const SCOPED_PREFIX = `\$\{PREFIX\}p:`;/);
    expect(PROTECTED_PREFIX).toBe('@ProductivityPet:');
  });

  test('the fence wraps all seven mutating methods and nothing else (reads and third-party keys are never touched)', () => {
    const fence = ALL.find((s) => s.file === 'src/utils/storage-fence.ts')!;
    for (const method of ['setItem', 'multiSet', 'mergeItem', 'multiMerge', 'removeItem', 'multiRemove', 'clear']) {
      expect(fence.code).toMatch(new RegExp(`storage\\.${method} = guard`));
    }
    expect(fence.code).not.toMatch(/storage\.(getItem|multiGet|getAllKeys) =/);
  });
});
