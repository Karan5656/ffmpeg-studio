import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View, type ViewStyle } from 'react-native';

export interface Theme {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  chip: string;
  danger: string;
  success: string;
}

const light: Theme = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  text: '#16181D',
  muted: '#6B7280',
  border: '#E3E5E9',
  accent: '#2563EB',
  accentText: '#FFFFFF',
  chip: '#EEF0F3',
  danger: '#C62828',
  success: '#1B7F3B',
};

const dark: Theme = {
  bg: '#0F1115',
  card: '#191C22',
  text: '#ECEEF2',
  muted: '#9AA1AD',
  border: '#2A2E36',
  accent: '#4C8DFF',
  accentText: '#FFFFFF',
  chip: '#242830',
  danger: '#FF6B6B',
  success: '#4ADE80',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function Card({ t, children, style }: { t: Theme; children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function Section({ t, title, children, note }: { t: Theme; title: string; children: ReactNode; note?: string }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.muted }]}>{title}</Text>
      {children}
      {note ? <Text style={[styles.note, { color: t.muted }]}>{note}</Text> : null}
    </View>
  );
}

export function Pill({ t, label, on, onPress, disabled }: {
  t: Theme; label: string; on?: boolean; onPress?: () => void; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: on ? t.accent : t.chip, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.pillText, { color: on ? t.accentText : t.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Button({ t, label, onPress, kind = 'primary', disabled }: {
  t: Theme; label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean;
}) {
  const bg = kind === 'primary' ? t.accent : t.chip;
  const fg = kind === 'primary' ? t.accentText : kind === 'danger' ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ t, fraction }: { t: Theme; fraction: number }) {
  return (
    <View style={[styles.track, { backgroundColor: t.chip }]}>
      <View style={[styles.bar, { backgroundColor: t.accent, width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginBottom: 12 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  note: { fontSize: 13, marginTop: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  pillText: { fontSize: 15, fontWeight: '500' },
  button: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
});
