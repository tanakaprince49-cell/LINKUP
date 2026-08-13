import React, { useCallback, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { COLORS } from '../theme/theme';

type Props = {
  visible: boolean;
  name?: string;
  busy?: boolean;
  onCancel: () => void;
  onSend: (message: string) => void;
};

export default function ConnectionNoteModal({ visible, name, busy, onCancel, onSend }: Props) {
  const [note, setNote] = useState('');
  const who = name || 'this builder';
  React.useEffect(() => {
    if (visible) setNote('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.kicker}>CONNECTION NOTE</Text>
          <Text style={styles.title}>Ask {who} to talk</Text>
          <Text style={styles.sub}>Add a short note so they know why. They see this before they approve.</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Hey — I’m building X and think we should talk because…"
            placeholderTextColor="#888"
            multiline
            maxLength={280}
            style={styles.input}
            editable={!busy}
          />
          <Text style={styles.count}>{note.trim().length}/280</Text>
          <TouchableOpacity style={styles.send} disabled={busy} onPress={() => onSend(note.trim())} activeOpacity={0.88}>
            <Text style={styles.sendText}>{busy ? 'Sending…' : 'Send request'}</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function useConnectionNote() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = React.useRef<((value: string | null) => void) | null>(null);

  const ask = useCallback((personName?: string) => {
    setName(personName || 'this builder');
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (value: string | null) => {
    setOpen(false);
    setBusy(false);
    resolver.current?.(value);
    resolver.current = null;
  };

  const modal = (
    <ConnectionNoteModal
      visible={open}
      name={name}
      busy={busy}
      onCancel={() => finish(null)}
      onSend={(message) => finish(message)}
    />
  );

  return { ask, modal, setBusy };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    paddingBottom: 28,
  },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: '#888' },
  title: { marginTop: 6, fontSize: 22, fontWeight: '900', color: '#111' },
  sub: { marginTop: 6, fontSize: 14, fontWeight: '600', color: '#555', lineHeight: 20 },
  input: {
    marginTop: 16,
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    padding: 14,
    fontSize: 15,
    fontWeight: '600',
    textAlignVertical: 'top',
    color: '#111',
    backgroundColor: '#FAFAFA',
  },
  count: { marginTop: 6, textAlign: 'right', fontSize: 11, fontWeight: '700', color: '#999' },
  send: {
    marginTop: 14,
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontSize: 16, fontWeight: '900', color: '#111' },
  cancel: { marginTop: 10, alignItems: 'center', padding: 10 },
  cancelText: { fontSize: 15, fontWeight: '800', color: '#888' },
});
