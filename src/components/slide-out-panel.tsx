import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Spacing } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

// A gentle slide-out panel docked to the left or right edge of Home. While closed
// only its small labelled tab is visible (the tab rides on the panel's edge, so it
// slides in together with it). The parent owns the open state, which is what keeps
// only ONE panel open at a time.
//
// Ways to open:  tap the tab, drag the tab inward, or swipe in from the screen edge.
// Ways to close: the Close button, tapping the dimmed room outside the panel, or
//                swiping the panel back toward its edge.
//
// Gestures only claim a touch once it is clearly horizontal, so vertical scrolling
// inside the panel and normal taps on the pet / care buttons are never blocked.
// While a panel is open the dimmed backdrop covers the room, so nothing behind it
// can be scrolled or tapped; the panel's own ScrollView scrolls independently.

const TAB_WIDTH = 36;
const TAB_HEIGHT = 150;
const EDGE_SWIPE_WIDTH = 14;
const SWIPE_CLAIM_PX = 10;
const OPEN_DURATION_MS = 280;
const CLOSE_DURATION_MS = 230;

type Props = {
  side: 'left' | 'right';
  // Shown on the tab and as the panel's title — always words, not just an icon.
  label: string;
  icon: IconName;
  // Pastel colour of the tab and the panel's header.
  tint: string;
  panelBackground: string;
  panelWidth: number;
  // Where the tab sits, as a fraction (0-1) of the available height.
  tabTop?: number;
  open: boolean;
  // True while the OTHER panel is open: this panel's tab fades away so it can't be mistaken
  // for part of the open panel (and can't be tapped through the dimmed room).
  tabHidden?: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function SlideOutPanel({
  side,
  label,
  icon,
  tint,
  panelBackground,
  panelWidth,
  tabTop = 0.36,
  open,
  tabHidden = false,
  onOpen,
  onClose,
  children,
}: Props) {
  const isLeft = side === 'left';
  // +1 when moving the panel INTO view means moving right (left panel).
  const openSign = isLeft ? 1 : -1;
  const useNative = Platform.OS !== 'web';

  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const progressValue = useRef(open ? 1 : 0);
  const openRef = useRef(open);
  const widthRef = useRef(panelWidth);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const dragStart = useRef(0);
  openRef.current = open;
  widthRef.current = panelWidth;
  onOpenRef.current = onOpen;
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressValue.current = value;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  function animateTo(target: 0 | 1) {
    Animated.timing(progress, {
      toValue: target,
      duration: target === 1 ? OPEN_DURATION_MS : CLOSE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: useNative,
    }).start();
  }

  // Follows the open state set by the parent (tab tap, backdrop, another panel opening).
  useEffect(() => {
    animateTo(open ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dragTo(dx: number) {
    const next = Math.min(1, Math.max(0, dragStart.current + (openSign * dx) / widthRef.current));
    progress.setValue(next);
  }

  // Decides open/closed when a drag ends, from how far it went and how fast.
  function settle(dx: number, vx: number) {
    const signedVelocity = openSign * vx;
    const shouldOpen = signedVelocity > 0.35 ? true : signedVelocity < -0.35 ? false : progressValue.current > 0.5;
    if (shouldOpen) {
      animateTo(1);
      if (!openRef.current) onOpenRef.current();
    } else {
      animateTo(0);
      if (openRef.current) onCloseRef.current();
    }
  }

  // The tab: a tap toggles the panel, a drag pulls it open (or closed).
  const tabResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        progress.stopAnimation((value) => {
          dragStart.current = value;
        });
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) > 4) dragTo(g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
          if (openRef.current) onCloseRef.current();
          else onOpenRef.current();
          return;
        }
        settle(g.dx, g.vx);
      },
      onPanResponderTerminate: () => animateTo(openRef.current ? 1 : 0),
    })
  ).current;

  // Swiping the OPEN panel toward its edge closes it. Only claims clearly horizontal
  // moves in the closing direction, so vertical scrolling inside is untouched.
  const panelResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        openRef.current && openSign * g.dx < -SWIPE_CLAIM_PX && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        progress.stopAnimation((value) => {
          dragStart.current = value;
        });
      },
      onPanResponderMove: (_e, g) => dragTo(g.dx),
      onPanResponderRelease: (_e, g) => settle(g.dx, g.vx),
      onPanResponderTerminate: () => animateTo(openRef.current ? 1 : 0),
    })
  ).current;

  // A thin strip along the screen edge: swiping inward from it opens the panel. It only
  // claims clearly horizontal inward moves, so it never swallows a plain tap.
  const edgeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !openRef.current && openSign * g.dx > SWIPE_CLAIM_PX && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        dragStart.current = progressValue.current;
      },
      onPanResponderMove: (_e, g) => dragTo(g.dx),
      onPanResponderRelease: (_e, g) => settle(g.dx, g.vx),
      onPanResponderTerminate: () => animateTo(openRef.current ? 1 : 0),
    })
  ).current;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: isLeft ? [-panelWidth, 0] : [panelWidth, 0],
  });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const webNoTouchAction = Platform.OS === 'web' ? ({ touchAction: 'none' } as object) : null;
  const webPanY = Platform.OS === 'web' ? ({ touchAction: 'pan-y' } as object) : null;

  return (
    <>
      {/* Dimmed room behind an open panel: tapping it closes the panel, and it stops
          the room underneath from being touched or scrolled while the panel is open. */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${label}`}
        />
      </Animated.View>

      {!open ? (
        <View
          {...edgeResponder.panHandlers}
          style={[styles.edgeSwipe, isLeft ? { left: 0 } : { right: 0 }, webPanY]}
        />
      ) : null}

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.dock,
          { width: panelWidth + TAB_WIDTH, transform: [{ translateX }] },
          isLeft ? { left: 0 } : { right: 0 },
        ]}>
        {/* The panel itself. */}
        <View
          {...panelResponder.panHandlers}
          style={[
            styles.panel,
            { width: panelWidth, backgroundColor: panelBackground },
            isLeft ? { left: 0, borderTopRightRadius: 28, borderBottomRightRadius: 28 } : { right: 0, borderTopLeftRadius: 28, borderBottomLeftRadius: 28 },
            webPanY,
          ]}>
          <View style={[styles.panelHeader, { backgroundColor: tint }]}>
            <Ionicons name={icon} size={22} color="#5B3F6B" />
            <Text style={styles.panelTitle} numberOfLines={1}>
              {label}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${label}`}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Ionicons name={isLeft ? 'chevron-back' : 'chevron-forward'} size={18} color="#5B3F6B" />
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={[styles.scroll, Platform.OS === 'web' ? ({ overscrollBehavior: 'contain' } as object) : null]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>

        {/* The always-visible tab: icon + words + an arrow showing which way it opens. */}
        <View
          {...tabResponder.panHandlers}
          pointerEvents={tabHidden ? 'none' : 'auto'}
          accessibilityRole="button"
          accessibilityLabel={`${open ? 'Close' : 'Open'} ${label}`}
          style={[
            styles.tab,
            { backgroundColor: tint, top: `${tabTop * 100}%`, opacity: tabHidden ? 0 : 1 },
            isLeft
              ? { left: panelWidth, borderTopRightRadius: 18, borderBottomRightRadius: 18 }
              : { left: 0, borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
            webNoTouchAction,
            Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null,
          ]}>
          <Ionicons
            name={open ? (isLeft ? 'chevron-back' : 'chevron-forward') : isLeft ? 'chevron-forward' : 'chevron-back'}
            size={16}
            color="#5B3F6B"
          />
          <View style={styles.tabLabelBox} pointerEvents="none">
            <View style={styles.tabLabelRotated}>
              <Ionicons name={icon} size={14} color="#5B3F6B" />
              <Text style={styles.tabLabel} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(91, 63, 107, 0.28)',
    zIndex: 20,
  },
  edgeSwipe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: EDGE_SWIPE_WIDTH,
    zIndex: 21,
  },
  dock: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 22,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    shadowColor: '#5B3F6B',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  panelTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#5B3F6B',
  },
  closeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 36,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
  } as object,
  closeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5B3F6B',
  },
  pressed: {
    opacity: 0.7,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  tab: {
    position: 'absolute',
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: Spacing.two,
    gap: Spacing.one,
    shadowColor: '#5B3F6B',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  tabLabelBox: {
    flex: 1,
    width: TAB_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabelRotated: {
    width: TAB_HEIGHT - 36,
    height: TAB_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transform: [{ rotate: '-90deg' }],
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5B3F6B',
  },
});
