import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet, Text } from 'react-native';

import { PinEntry } from '@/components/pin-entry';
import { RecoveryCodeField } from '@/components/recovery-code';
import { setCurrentLanguage, translate } from '@/i18n';

const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params);
const es = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('es', key, params);

// A parent that keeps the value in its own state, like the real screens do.
function Host({ onSubmit, disabled, onValue }: { onSubmit?: () => void; disabled?: boolean; onValue?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <PinEntry
      label="PIN"
      value={value}
      disabled={disabled}
      onSubmit={onSubmit}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const typePad = async (digits: string) => {
  for (const d of digits) await press(d);
};

beforeEach(() => {
  setCurrentLanguage('en');
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => {
  jest.restoreAllMocks();
  setCurrentLanguage('en');
});

describe('the on-screen number pad', () => {
  test('has every digit, a delete key and a clear key, each with an accessible name', async () => {
    await render(<Host />);
    for (const name of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', en('pinKeyBackspace'), en('pinKeyClear')]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByLabelText(en('pinPadLabel'))).toBeTruthy();
  });

  test('typing, deleting and clearing change the value; it stops at 4 digits', async () => {
    const seen: string[] = [];
    await render(<Host onValue={(v) => seen.push(v)} />);
    await typePad('1234');
    expect(seen.at(-1)).toBe('1234');
    await press(en('pinKeyBackspace'));
    expect(seen.at(-1)).toBe('123');
    await press(en('pinKeyClear'));
    expect(seen.at(-1)).toBe('');
    await typePad('123456789');
    expect(seen.at(-1)).toBe('1234');
  });

  test('digits are only ever shown as dots: the screen reader hears a count, never the digits', async () => {
    await render(<Host />);
    await typePad('2468');
    expect(screen.getByText(en('pinDigitsEntered_other', { count: 4 }))).toBeTruthy();
    const dots = screen.getAllByLabelText('PIN').find((e) => e.props.accessibilityValue?.text);
    expect(dots?.props.accessibilityValue).toEqual({ text: '4 digits entered' });
    // the digits live only in the masked (secureTextEntry) field's value; no text or accessibility string carries them
    expect(screen.queryByText('2468')).toBeNull();
    const spoken = JSON.stringify(screen.toJSON(), (k, v) => (k === 'value' ? undefined : v));
    expect(spoken).not.toContain('2468');
    await press(en('pinKeyClear'));
    await press('1');
    expect(screen.getByText(en('pinDigitsEntered_one', { count: 1 }))).toBeTruthy();
  });

  test('the count is announced politely (a live region), in Spanish too', async () => {
    setCurrentLanguage('es');
    await render(<Host />);
    await press('7');
    await press('7');
    const count = screen.getByText(es('pinDigitsEntered_other', { count: 2 }));
    expect(count.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByRole('button', { name: es('pinKeyBackspace') })).toBeTruthy();
    expect(screen.getByText(es('pinUseKeyboard'))).toBeTruthy();
  });

  test('disabled: the keys do nothing', async () => {
    const seen: string[] = [];
    await render(<Host disabled onValue={(v) => seen.push(v)} />);
    await press('5');
    expect(seen).toEqual([]);
    expect(screen.getByRole('button', { name: '5' }).props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('a physical keyboard', () => {
  test('types into a hidden field that assistive technology cannot reach, keeps digits only and stops at 4', async () => {
    const seen: string[] = [];
    await render(<Host onValue={(v) => seen.push(v)} />);
    const hidden = screen.getByTestId('pin-hardware-input', { includeHiddenElements: true });
    expect(hidden.props.accessibilityElementsHidden).toBe(true);
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
    await fireEvent.changeText(hidden, '12ab34');
    expect(seen.at(-1)).toBe('1234');
    await fireEvent.changeText(hidden, '123456789012');
    expect(seen.at(-1)).toBe('1234');
  });

  test('the hidden field is masked and has autofill, suggestions and the context menu off', async () => {
    await render(<Host />);
    const p = screen.getByTestId('pin-hardware-input', { includeHiddenElements: true }).props;
    expect(p).toMatchObject({
      secureTextEntry: true,
      keyboardType: 'number-pad',
      autoComplete: 'off',
      importantForAutofill: 'noExcludeDescendants',
      textContentType: 'none',
      autoCorrect: false,
      spellCheck: false,
      contextMenuHidden: true,
      showSoftInputOnFocus: false,
    });
  });

  test('Enter submits', async () => {
    const submit = jest.fn();
    await render(<Host onSubmit={submit} />);
    await fireEvent(screen.getByTestId('pin-hardware-input', { includeHiddenElements: true }), 'submitEditing');
    expect(submit).toHaveBeenCalled();
  });
});

describe('the device-keyboard fallback (for assistive technology and for anyone who prefers it)', () => {
  test('"Use the device keyboard instead" shows a masked number field with every sensitive option off, and can go back', async () => {
    const seen: string[] = [];
    await render(<Host onValue={(v) => seen.push(v)} />);
    await press(en('pinUseKeyboard'));
    const input = screen.getByLabelText('PIN');
    expect(input.props).toMatchObject({
      secureTextEntry: true,
      keyboardType: 'number-pad',
      inputMode: 'numeric',
      maxLength: 4,
      autoComplete: 'off',
      importantForAutofill: 'noExcludeDescendants',
      textContentType: 'none',
      autoCorrect: false,
      spellCheck: false,
      contextMenuHidden: true,
    });
    await fireEvent.changeText(input, '98a7654321');
    expect(seen.at(-1)).toBe('9876');
    expect(screen.queryByRole('button', { name: '1' })).toBeNull(); // the pad is gone
    await press(en('pinUsePad'));
    expect(screen.getByRole('button', { name: '1' })).toBeTruthy();
  });

  test('with a screen reader on, the device keyboard is the default', async () => {
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(true);
    await render(<Host />);
    await act(async () => {});
    expect(screen.getByTestId('pin-keyboard-input')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
    await press(en('pinUsePad')); // and the person can still choose the pad
    expect(screen.getByRole('button', { name: '1' })).toBeTruthy();
  });

  test('a choice made by the person is not overridden when the screen reader state changes later', async () => {
    let listener: ((on: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_n: string, cb: (on: boolean) => void) => {
      listener = cb;
      return { remove: jest.fn() };
    }) as never);
    await render(<Host />);
    await press(en('pinUseKeyboard'));
    await act(async () => listener?.(false));
    expect(screen.getByTestId('pin-keyboard-input')).toBeTruthy();
  });
});

describe('touch targets and the landscape layout', () => {
  const minHeight = (name: string) => {
    const style = StyleSheet.flatten(screen.getByRole('button', { name }).props.style) as { minHeight?: number };
    return style?.minHeight ?? 0;
  };
  const useWindow = (width: number, height: number) =>
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 1, fontScale: 1 });

  test('"Use the device keyboard instead" and "Use the number pad" are at least 44 px tall', async () => {
    await render(<Host />);
    expect(minHeight(en('pinUseKeyboard'))).toBeGreaterThanOrEqual(44);
    await press(en('pinUseKeyboard'));
    expect(minHeight(en('pinUsePad'))).toBeGreaterThanOrEqual(44);
  });

  test('on a tall screen the own buttons of the screen come after the pad', async () => {
    useWindow(390, 844);
    await render(
      <PinEntry label="PIN" value="" onChange={() => {}}>
        <Text>after-the-pad</Text>
      </PinEntry>,
    );
    expect(screen.getByText('after-the-pad')).toBeTruthy();
    expect(screen.getByRole('button', { name: '5' })).toBeTruthy();
  });

  test('on a short landscape screen the pad keys stay at least 44 px and the buttons of the screen are still there', async () => {
    useWindow(844, 390);
    await render(
      <PinEntry label="PIN" value="" onChange={() => {}}>
        <Text>beside-the-pad</Text>
      </PinEntry>,
    );
    expect(screen.getByText('beside-the-pad')).toBeTruthy();
    const key = StyleSheet.flatten(screen.getByRole('button', { name: '5' }).props.style) as { width?: number; height?: number };
    expect(key.width).toBeGreaterThanOrEqual(44);
    expect(key.height).toBe(key.width);
  });

  test('the device-keyboard field also shows the buttons of the screen', async () => {
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(true);
    await render(
      <PinEntry label="PIN" value="" onChange={() => {}}>
        <Text>with-the-field</Text>
      </PinEntry>,
    );
    await act(async () => {});
    expect(screen.getByTestId('pin-keyboard-input')).toBeTruthy();
    expect(screen.getByText('with-the-field')).toBeTruthy();
  });

  test('the recovery-code field is at least 48 px tall', async () => {
    await render(<RecoveryCodeField value="" onChange={() => {}} />);
    const style = StyleSheet.flatten(screen.getByLabelText(en('rcFieldLabel')).props.style) as { minHeight?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });
});
