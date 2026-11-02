// Every test file gets an in-memory AsyncStorage; it never touches real saves.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
