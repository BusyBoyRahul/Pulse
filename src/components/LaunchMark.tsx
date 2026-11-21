import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StatusBar, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';

/**
 * Plain brand blue with the white Pulse mark: the ONE picture shown while Pulse starts (Android's own start-up screen is plain
 * blue, so the mark appears only here). It is centred on the whole screen, and eases in once.
 */
export function LaunchMark() {
  // The mark eases in once (Android shows plain blue until now), so there is a single, calm appearance.
  const show = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(show, {toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }, [show]);
  return (
    <View style={{flex: 1, backgroundColor: '#2F8BFF', alignItems: 'center', justifyContent: 'center'}}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <Animated.View style={{opacity: show, transform: [{scale: show.interpolate({inputRange: [0, 1], outputRange: [0.94, 1]})}]}}>
      <Svg width={132} height={114} viewBox="170 245 900 780" fill="none">
        <Path d="M480 288H760C925 288 1025 420 1025 610C1025 810 905 933 740 933C650 933 560 925 470 898L300 980L338 832C255 770 217 695 217 610C217 430 330 288 480 288Z" stroke="#FFFFFF" strokeWidth={74} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M325 630H430L490 565L550 745L640 450L722 735L785 635H910" stroke="#FFFFFF" strokeWidth={60} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      </Animated.View>
    </View>
  );
}

export default LaunchMark;
