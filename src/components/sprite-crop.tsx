import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

type SpriteCropProps = {
  // A require()'d local asset — same convention as RoomPreview's `source`
  // in rooms-card.tsx.
  source: number;
  // Full sheet's own pixel dimensions.
  sheetWidth: number;
  sheetHeight: number;
  // The crop region, in the sheet's own pixel coordinates.
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  // The square box this renders within.
  size: number;
};

// Generic reusable crop: reveals one rectangular region of a larger sprite
// sheet, scaled to fit inside a square box without stretching and without
// cropping further — same two-layer technique already used for one-off
// crops like PetStageIcon/TaskIcon (scale the full sheet up, offset by the
// crop's own top-left, inside an overflow-hidden frame), generalized here
// to take the crop region as props instead of hardcoding it per asset, so
// any sprite sheet with known crop bounds can reuse this one component.
//
// Two nested overflow-hidden frames: the outer is the fixed `size x size`
// box (and centers its contents, so a non-square crop doesn't stretch to
// fill it — scale is chosen by the SMALLER of width/height-fit, i.e.
// "contain" behavior); the inner is sized to exactly the crop's own
// aspect ratio at that scale, and clips the oversized sheet image down to
// just that one region.
export function SpriteCrop({
  source,
  sheetWidth,
  sheetHeight,
  cropX,
  cropY,
  cropWidth,
  cropHeight,
  size,
}: SpriteCropProps) {
  const scale = Math.min(size / cropWidth, size / cropHeight);
  const windowWidth = cropWidth * scale;
  const windowHeight = cropHeight * scale;

  return (
    <View style={[styles.outer, { width: size, height: size }]}>
      <View style={[styles.inner, { width: windowWidth, height: windowHeight }]}>
        <Image
          source={source}
          contentFit="fill"
          style={{
            position: 'absolute',
            width: sheetWidth * scale,
            height: sheetHeight * scale,
            left: -cropX * scale,
            top: -cropY * scale,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  inner: {
    overflow: 'hidden',
  },
});
