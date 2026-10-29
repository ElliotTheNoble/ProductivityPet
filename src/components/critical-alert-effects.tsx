import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Vibration, View } from 'react-native';

import { getAlertSettings, subscribeToCriticalAlert } from '@/utils/pet-alerts';

// The in-app side of a Critical alert: when a pet turns Critical WHILE THE APP
// IS OPEN, optionally vibrate three short pulses and flash the phone's
// flashlight three times (on/off, on/off, on/off), in step with each other.
//
// Strict limits, by design:
//  - Opt-in only: the flashlight only runs if the player turned it on in the
//    Alerts settings (off by default) AND camera permission was granted there.
//    This component never asks for permission itself.
//  - Only while the app is open. Android does not reliably allow apps to
//    control the flashlight from the background, so closed-app alerts are
//    normal notifications (and Samsung's own Camera Flash Notification, which
//    the player enables in system settings).
//  - Fires once per sickness episode (the alert module announces each episode
//    once), never on render or launch.
//  - The visual (non-flashing) alternative is the red health panel in the pet
//    family bar, which is always shown for a critical pet.
//
// The torch is driven through expo-camera's CameraView (the supported way to
// switch the torch on in Expo); it is mounted invisibly (1x1, transparent)
// only for the few seconds of the sequence.

const PULSE_MS = 250;
const PULSES = 3;
const CAMERA_WARMUP_MS = 700;
// Vibrate in step with the flashes: [wait, buzz, pause, buzz, pause, buzz]
const VIBRATION_PATTERN = [0, PULSE_MS, PULSE_MS, PULSE_MS, PULSE_MS, PULSE_MS];

type CameraModule = typeof import('expo-camera');

function loadCameraModule(): CameraModule | null {
  try {
    return require('expo-camera') as CameraModule;
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function CriticalAlertEffects() {
  const [cameraActive, setCameraActive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const running = useRef(false);
  const camera = useRef<CameraModule | null>(null);

  useEffect(() => {
    return subscribeToCriticalAlert(() => {
      if (running.current) return;
      running.current = true;
      void (async () => {
        try {
          const settings = await getAlertSettings();
          let flashing = false;

          if (settings.flash && Platform.OS !== 'web') {
            camera.current = camera.current ?? loadCameraModule();
            const granted = camera.current
              ? (await camera.current.Camera.getCameraPermissionsAsync()).granted
              : false;
            if (granted) {
              setCameraActive(true);
              await wait(CAMERA_WARMUP_MS);
              flashing = true;
            }
          }

          if (settings.vibration) Vibration.vibrate(VIBRATION_PATTERN);

          if (flashing) {
            for (let i = 0; i < PULSES; i += 1) {
              setTorchOn(true);
              await wait(PULSE_MS);
              setTorchOn(false);
              await wait(PULSE_MS);
            }
          }
        } catch {
          // Hardware unavailable or permission changed: skip quietly.
        } finally {
          setTorchOn(false);
          setCameraActive(false);
          running.current = false;
        }
      })();
    });
  }, []);

  if (!cameraActive || !camera.current) return null;
  const CameraView = camera.current.CameraView;
  return (
    <View style={styles.hidden} pointerEvents="none">
      <CameraView style={styles.hidden} facing="back" enableTorch={torchOn} />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', bottom: 0, left: 0, width: 1, height: 1, opacity: 0 },
});
