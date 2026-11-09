import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type View } from 'react-native';

// Keeps a text field visible above the on-screen keyboard on a scrolling page.
//
// Why it measures instead of assuming: on Android 15+ the app draws edge to edge and the system may NOT shrink the window when the
// keyboard opens (which used to be what kept a field in view), while on older versions it still does. So this asks where the
// keyboard really starts on screen and how far down the page really reaches, adds only the overlap as space at the bottom of the
// page (nothing when the window was already resized), and scrolls the focused field above the keyboard. It touches no storage and
// no text: it only reads positions.
//
// Use: put `frameRef` on a View that wraps the ScrollView, `scrollRef` and `onScroll` on the ScrollView, and add `bottomInset` to
// its content's bottom padding.
export function useKeyboardAvoidance() {
  const scrollRef = useRef<ScrollView>(null);
  const frameRef = useRef<View>(null);
  const scrollY = useRef(0);
  const [bottomInset, setBottomInset] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardTop = event?.endCoordinates?.screenY;
      if (typeof keyboardTop !== 'number') return;
      frameRef.current?.measureInWindow((_x, y, _w, height) => {
        setBottomInset(Math.max(0, Math.round(y + height - keyboardTop)));
        // Once the extra space is in, bring the field being typed into view (a frame later, so the page is tall enough to scroll).
        timers.push(
          setTimeout(() => {
            try {
              const input = TextInput.State?.currentlyFocusedInput?.();
              input?.measureInWindow?.((_ix, iy, _iw, ih) => {
                const hidden = iy + ih - (keyboardTop - 16);
                if (hidden > 0) scrollRef.current?.scrollTo({ y: scrollY.current + hidden, animated: true });
              });
            } catch {
              // positions unavailable: the extra space at the bottom still lets the person scroll to the field
            }
          }, 60),
        );
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setBottomInset(0));
    return () => {
      show.remove();
      hide.remove();
      timers.forEach(clearTimeout);
    };
  }, []);

  return {
    scrollRef,
    frameRef,
    bottomInset,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = event.nativeEvent.contentOffset.y;
    },
  };
}
