import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { StatsHubScreen } from '@/components/stats-screen';
import { translate } from '@/i18n';

// Regression: the Stats cards (Pet Progress, Lifetime Stats) must NOT use a percentage height. Inside the content-sized column and the
// scroll area, Android reads `height: '100%'` as far taller than the content, so the cards spilled past the scrollable area and the page
// looked blank on a phone (the browser, which treats it as "auto", was fine). Jest cannot measure Android layout, so this pins the style.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), usePathname: () => '/stats', Link: 'Link' }));

const en = (key: Parameters<typeof translate>[1]) => translate('en', key);

// The card is the nearest ancestor of a title that carries the card's own border and padding.
function cardStyleAround(text: string) {
  let node = screen.getByText(text).parent;
  while (node) {
    const style = StyleSheet.flatten(node.props?.style) ?? {};
    if (style.borderRadius !== undefined && style.padding !== undefined && style.borderWidth === 2) return style;
    node = node.parent;
  }
  throw new Error(`no card found around "${text}"`);
}

test('the Stats cards grow to fill their column instead of using a percentage height', async () => {
  await render(<StatsHubScreen />);
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
  for (const title of [en('statsPetProgress'), en('statsLifetime')]) {
    const style = cardStyleAround(title);
    expect(style.height).toBeUndefined();
    expect(style.flexGrow).toBe(1);
  }
});

test('no style in the Stats screen sets a percentage height on a card', () => {
  const code = require('fs').readFileSync(require('path').resolve('src/components/stats-screen.tsx'), 'utf8') as string;
  const card = code.slice(code.indexOf('  card: {'), code.indexOf('  cardTitleLarge: {')).replace(/\/\/.*$/gm, '');
  expect(card).not.toMatch(/height:\s*'100%'/);
  expect(card).toMatch(/flexGrow:\s*1/);
});
