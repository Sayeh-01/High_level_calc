import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';

/** QR code drawn with plain Views, so it works on web and native without an SVG module. */
export function QR({ value, size = 180 }: { value: string; size?: number }) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  }, [value]);
  const cell = size / matrix.length;
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', direction: 'ltr' }} accessibilityLabel={value}>
      {matrix.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: cell, height: cell, backgroundColor: dark ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}
