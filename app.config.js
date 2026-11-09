// Dynamic Expo config. Expo reads app.json first and passes it in as `config`, so EVERYTHING in app.json (slug, project id, updates,
// runtime version, plugins, permissions, icons, the production settings) is used exactly as written; this file only changes two
// things, and only for the development build:
//
//   APP_VARIANT=development  (set by the EAS "development" profile in eas.json, nowhere else)
//     name             "ProductivityPet Dev"
//     android.package  "com.elliotthenoble.productivitypet.dev"
//
// The development build is therefore a SEPARATE app on the phone, with its own empty storage, next to the real ProductivityPet; it can
// never replace or read the real app's data. Without APP_VARIANT (preview, production, `expo start`, tests) the config is returned
// untouched. The slug and the EAS project id stay the same, so the build still belongs to the same Expo project.
const DEVELOPMENT_NAME = 'ProductivityPet Dev';
const DEVELOPMENT_ANDROID_PACKAGE = 'com.elliotthenoble.productivitypet.dev';

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') return config;
  return {
    ...config,
    name: DEVELOPMENT_NAME,
    android: { ...config.android, package: DEVELOPMENT_ANDROID_PACKAGE },
  };
};
