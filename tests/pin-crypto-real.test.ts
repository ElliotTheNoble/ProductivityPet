import { DEFAULT_KDF } from '@/utils/kdf-params';
import { checkSecret, makeSecretRecord } from '@/utils/pin-crypto';

// The real production settings (no cheaper stand-in), once.
const nodeRandom = async (n: number) => new Uint8Array(require('crypto').randomBytes(n));

test('the production scrypt settings work end to end', async () => {
  expect(DEFAULT_KDF).toEqual({ alg: 'scrypt', N: 2 ** 15, r: 8, p: 1, dkLen: 32 });
  const started = Date.now();
  const record = await makeSecretRecord('pin', '135792', nodeRandom);
  expect(record.kdf.N).toBe(32768);
  expect(await checkSecret('pin', '135792', record)).toBe(true);
  expect(await checkSecret('pin', '135793', record)).toBe(false);
  // A rough guard on this machine only (Node is much faster than a phone's Hermes engine; see FEATURE-088).
  expect(Date.now() - started).toBeLessThan(15_000);
}, 30_000);
