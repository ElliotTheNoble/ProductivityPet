import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

type PawTokenCoinProps = {
  size?: number;
};

// assets/images/pawtoken.png is a 1536x1024 canvas with a lot of
// transparent padding around the actual coin art (measured via an
// alpha-channel bounding-box scan: the real content is roughly a
// 946x928 square centered around x=763, y=502) — rendering the whole
// canvas via contentFit="contain" would make the coin look much smaller
// than it needs to at small sizes. Same fixed sprite-crop technique
// already used for PetStageIcon/TaskIcon (and originally added inline in
// AppHeader for the header's own balance pill — extracted here so the
// Shop page can reuse the exact same crop without duplicating it per
// card): render the full image scaled up inside a small, overflow-hidden,
// circularly-masked frame, offset so only that content region is visible.
const SOURCE_WIDTH = 1536;
const SOURCE_HEIGHT = 1024;
const CROP_SIZE = 960;
const CROP_LEFT = 284;
const CROP_TOP = 23;

export function PawTokenCoin({ size = 20 }: PawTokenCoinProps) {
  const scale = size / CROP_SIZE;

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={require('@/assets/images/pawtoken.png')}
        contentFit="fill"
        style={{
          position: 'absolute',
          width: SOURCE_WIDTH * scale,
          height: SOURCE_HEIGHT * scale,
          left: -CROP_LEFT * scale,
          top: -CROP_TOP * scale,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
  },
});
