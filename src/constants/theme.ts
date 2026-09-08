/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#4A3B42',
    background: '#FCF3E9', // cream
    backgroundElement: '#FBE3EC', // blush pink
    backgroundSelected: '#E6DBF8', // lavender
    textSecondary: '#9C8790',
    accent: '#F28DAE', // blush/coral accent for primary buttons
    mint: '#7FD9B6', // mint accent for progress + checkmarks
    peach: '#FBD9B8', // peach accent for the pet progress card
  },
  dark: {
    text: '#4A3B42',
    background: '#FCF3E9',
    backgroundElement: '#FBE3EC',
    backgroundSelected: '#E6DBF8',
    textSecondary: '#9C8790',
    accent: '#F28DAE',
    mint: '#7FD9B6',
    peach: '#FBD9B8',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
