import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { getStageImage } from '@/components/pet-placeholder';
import { SpriteCrop } from '@/components/sprite-crop';
import type { PetStage } from '@/utils/pet-stage';
import { getRoomPetArt } from '@/utils/room-pet-art';
import type { RoomSlug } from '@/utils/rooms';

type RoomPetProps = {
  roomSlug: RoomSlug;
  stage: PetStage;
  // Whether Kitty currently counts as dirty (see isPetDirty in
  // @/utils/pet-needs.ts), passed down from @/components/room-detail-screen.tsx.
  // Only affects the Bathroom's shared getStageImage branch below — the 4
  // activity rooms keep their own dedicated sprite art regardless of this
  // value, per the dirty-kitty spec (Study Room/Gym/Bedroom/Kitchen don't
  // get a dirty variant yet). Optional/defaulted to false so this stays a
  // no-op for any caller that doesn't pass it.
  isDirty?: boolean;
};

// Shows the pet in its Room detail page, at its current growth stage.
// Purely decorative: no Feed/Bath/Play/Rest buttons, no need bars, and no
// equippedAccessoryId prop at all — accessories can't render here because
// this component never even accepts/looks at that value, not because of a
// flag that hides it. The Living Room's own pet
// (@/components/pet-placeholder.tsx, used via @/components/pet-room.tsx
// on Home) is a completely separate component and keeps rendering
// equipped accessories exactly as before.
//
// Two rendering paths, depending on room and stage:
// - Egg (every room) and Bathroom (every stage — it has no dedicated
//   activity sprite sheet of its own yet, unlike Study Room/Gym/Bedroom/
//   Kitchen) use the SAME shared "normal" pet art Home already shows, via
//   getStageImage (@/components/pet-placeholder.tsx) — reusing those
//   exact assets/aspect ratios rather than duplicating them.
// - Every other room/stage combination (Study Room/Gym/Bedroom/Kitchen,
//   any stage but Egg) uses that room's own activity sprite crop — see
//   @/utils/room-pet-art.ts.
//
// Sizing: fills whatever box its parent gives it (see styles.wrapper),
// measured via onLayout — the same "measure the real box, then hand exact
// pixel dimensions down" technique already used for Memory Match's card
// grid (see memory-match-game.tsx's boardSurface). Both rendering paths
// contain-fit within that box (letterboxing on whichever axis the
// artwork's own aspect ratio doesn't fill) rather than stretching.
export function RoomPet({ roomSlug, stage, isDirty = false }: RoomPetProps) {
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setBoxSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }

  const hasBox = boxSize.width > 0 && boxSize.height > 0;

  if (stage === 'Egg' || roomSlug === 'bathroom') {
    // isDirty only ever matters for the Bathroom (Egg has no dirty variant
    // at all — getStageImage falls through to normal Egg art regardless —
    // and the other 3 rooms that can reach this branch via Egg shouldn't
    // show Dirty Kitty before she's even hatched).
    const { source, aspectRatio } = getStageImage(stage, roomSlug === 'bathroom' && isDirty);
    return (
      <View style={styles.wrapper} onLayout={handleLayout}>
        {hasBox ? (
          <Image
            source={source}
            contentFit="contain"
            style={{
              width: Math.min(boxSize.width, boxSize.height * aspectRatio),
              height: Math.min(boxSize.height, boxSize.width / aspectRatio),
            }}
          />
        ) : null}
      </View>
    );
  }

  // roomSlug is narrowed to RoomPetSlug and stage to RoomPetStage by the
  // early return above (neither 'bathroom' nor 'Egg' reaches here).
  const art = getRoomPetArt(roomSlug, stage);
  return (
    <View style={styles.wrapper} onLayout={handleLayout}>
      {hasBox ? <SpriteCrop {...art} width={boxSize.width} height={boxSize.height} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
