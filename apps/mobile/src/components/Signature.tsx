import { parseSignaturePath, type Signature } from '@circle/shared';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from './ui';

type Pt = [number, number];
const INK = colors.text;
const THICK = 2.5;

/** One straight piece of a stroke, as a rotated View (no SVG module needed, same idea as the QR code). */
function Segment({ a, b }: { a: Pt; b: Pt }) {
  const len = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: (a[0] + b[0]) / 2 - len / 2, top: (a[1] + b[1]) / 2 - THICK / 2, width: len, height: THICK, borderRadius: THICK / 2, backgroundColor: INK, transform: [{ rotate: `${angle}rad` }] }}
    />
  );
}

function Strokes({ strokes, scale = 1 }: { strokes: Pt[][]; scale?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      {strokes.flatMap((s, i) => s.slice(1).map((p, j) => <Segment key={`${i}-${j}`} a={[s[j][0] * scale, s[j][1] * scale]} b={[p[0] * scale, p[1] * scale]} />))}
    </View>
  );
}

export function strokesToPath(strokes: Pt[][]): string {
  return strokes
    .filter((s) => s.length)
    .map((s) => {
      const pts = s.length === 1 ? [s[0], [s[0][0] + 1, s[0][1]] as Pt] : s;
      return `M${pts[0][0]} ${pts[0][1]}${pts.slice(1).map((p) => `L${p[0]} ${p[1]}`).join('')}`;
    })
    .join('');
}

/** Draw with a finger (or the mouse on web). Coordinates are whole pixels of the pad, as the server expects. */
export function SignaturePad({ onChange, height = 140, testID }: { onChange: (v: { path: string; width: number; height: number } | null) => void; height?: number; testID?: string }) {
  const [width, setWidth] = useState(0);
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const live = useRef<Pt[][]>([]);
  const size = useRef({ w: 0, h: height });
  const clamp = (x: number, y: number): Pt => [Math.round(Math.min(size.current.w, Math.max(0, x))), Math.round(Math.min(size.current.h, Math.max(0, y)))];
  const publish = () => {
    setStrokes(live.current.map((s) => [...s]));
    onChange(live.current.length ? { path: strokesToPath(live.current), width: Math.round(size.current.w), height: size.current.h } : null);
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          live.current = [...live.current, [clamp(e.nativeEvent.locationX, e.nativeEvent.locationY)]];
          publish();
        },
        onPanResponderMove: (e) => {
          const s = live.current[live.current.length - 1];
          const p = clamp(e.nativeEvent.locationX, e.nativeEvent.locationY);
          const last = s[s.length - 1];
          if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 3) return; // keep the path short
          s.push(p);
          publish();
        },
      }),
    [],
  );
  return (
    <View>
      <View
        testID={testID}
        onLayout={(e: LayoutChangeEvent) => {
          setWidth(e.nativeEvent.layout.width);
          size.current = { w: Math.round(e.nativeEvent.layout.width), h: height };
        }}
        style={{ height, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: 12, backgroundColor: '#FFFFFF', overflow: 'hidden', direction: 'ltr' } as any}
        {...responder.panHandlers}>
        {width > 0 && <Strokes strokes={strokes} />}
        <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 28, height: 1, backgroundColor: colors.border }} />
      </View>
      {strokes.length > 0 && (
        <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
          <ClearLink
            onPress={() => {
              live.current = [];
              publish();
            }}
          />
        </View>
      )}
    </View>
  );
}

function ClearLink({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Text onPress={onPress} style={{ color: colors.primary, padding: 6 }} accessibilityRole="button" testID="signature-clear">
      {t('forms.clear')}
    </Text>
  );
}

/** A stored signature drawn again, scaled to `width`. */
export function SignatureView({ signature, width = 220, testID }: { signature: Signature; width?: number; testID?: string }) {
  const scale = width / signature.width;
  const strokes = useMemo(() => parseSignaturePath(signature.path), [signature.path]);
  return (
    <View testID={testID} style={{ width, height: signature.height * scale, direction: 'ltr' } as any}>
      <Strokes strokes={strokes} scale={scale} />
    </View>
  );
}
