import {themedStyles} from '@/theme/themed';
import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import qrcode from 'qrcode-generator';

/** A QR code drawn as one vector shape: always crisp, scans from any screen. Black on white on purpose. */
export function QrCode({value, size = 220}: {value: string; size?: number}) {
  const {path, n} = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          d += `M${c} ${r}h1v1h-1z`;
        }
      }
    }
    return {path: d, n: count};
  }, [value]);
  const quiet = 2; // the blank margin scanners need
  return (
    <View style={[styles.box, {width: size, height: size}]}>
      <Svg width={size - 24} height={size - 24} viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}>
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  box: {backgroundColor: '#FFFFFF', borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
}));

export default QrCode;
