const fs = require('fs');
const path = require('path');

// app.config.js: the development build is a separate Android app (own name and application ID); everything else, and every other
// variant, is exactly app.json. A wrong application ID here could replace the real app on a phone, so it is checked in detail.

const ORIGINAL_ID = 'com.elliotthenoble.productivitypet';
const DEV_ID = 'com.elliotthenoble.productivitypet.dev';

const appJson = (): { expo: Record<string, any> } => JSON.parse(fs.readFileSync(path.resolve('app.json'), 'utf8'));
const easJson = (): { build: Record<string, any> } => JSON.parse(fs.readFileSync(path.resolve('eas.json'), 'utf8'));

function resolve(variant: string | undefined) {
  const previous = process.env.APP_VARIANT;
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  try {
    jest.resetModules();
    const factory = require(path.resolve('app.config.js'));
    return factory({ config: JSON.parse(JSON.stringify(appJson().expo)) });
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
}

describe('app.config.js', () => {
  it('without APP_VARIANT it returns app.json unchanged (production and preview keep the original ID)', () => {
    const config = resolve(undefined);
    expect(config).toEqual(appJson().expo);
    expect(config.android.package).toBe(ORIGINAL_ID);
    expect(config.name).toBe('ProductivityPet');
  });

  it.each(['production', 'preview', '', 'Development', 'dev'])('APP_VARIANT=%j is not the development variant', (variant) => {
    expect(resolve(variant)).toEqual(appJson().expo);
  });

  it('the development variant changes only the name and the Android application ID', () => {
    const original = appJson().expo;
    const dev = resolve('development');
    expect(dev.name).toBe('ProductivityPet Dev');
    expect(dev.android.package).toBe(DEV_ID);
    expect(dev.android.package).not.toBe(ORIGINAL_ID);
    // everything else is identical, including the project id, updates, runtime version, plugins, slug, scheme and the rest of android
    expect({ ...dev, name: original.name, android: { ...dev.android, package: original.android.package } }).toEqual(original);
    expect(dev.slug).toBe(original.slug);
    expect(dev.extra.eas.projectId).toBe(original.extra.eas.projectId);
    expect(dev.updates).toEqual(original.updates);
    expect(dev.runtimeVersion).toEqual(original.runtimeVersion);
    expect(dev.plugins).toEqual(original.plugins);
    expect(dev.android.versionCode).toBe(original.android.versionCode);
  });

  it('does not change the original config object it was given', () => {
    const input = JSON.parse(JSON.stringify(appJson().expo));
    process.env.APP_VARIANT = 'development';
    try {
      jest.resetModules();
      require(path.resolve('app.config.js'))({ config: input });
    } finally {
      delete process.env.APP_VARIANT;
    }
    expect(input).toEqual(appJson().expo);
  });

  it('only the EAS development profile sets APP_VARIANT, and app.json keeps the original ID', () => {
    const { build } = easJson();
    expect(build.development.env).toEqual({ APP_VARIANT: 'development' });
    expect(build.development.developmentClient).toBe(true);
    expect(build.preview.env?.APP_VARIANT).toBeUndefined();
    expect(build.production.env?.APP_VARIANT).toBeUndefined();
    expect(JSON.stringify(build.preview)).not.toMatch(/APP_VARIANT/);
    expect(JSON.stringify(build.production)).not.toMatch(/APP_VARIANT/);
    expect(appJson().expo.android.package).toBe(ORIGINAL_ID);
  });
});
