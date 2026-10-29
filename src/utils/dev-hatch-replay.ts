// Development-only: lets Alerts -> Developer Tools ask Home to replay the Egg-to-Hatchling
// animation. The replay itself runs on Home (it is purely visual and never touches saved
// data); this tiny store just carries the request across screens. If Home isn't mounted yet
// (the player is on the Alerts screen), the request waits until Home mounts and consumes it.

let pending = false;
const listeners = new Set<() => void>();

export function requestDevHatchReplay(): void {
  if (!__DEV__) return;
  pending = true;
  listeners.forEach((listener) => listener());
}

// True once per request.
export function consumeDevHatchReplayRequest(): boolean {
  const wasPending = pending;
  pending = false;
  return wasPending;
}

export function subscribeToDevHatchReplayRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
