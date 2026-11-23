import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

/**
 * The door into the AI Agents beta, kept in its own component so the Linky
 * home header stays a plain mount point. Alex and the workforce live one tap
 * from the chat where members already delegate finding people.
 */
export default function AiWorkforceEntry() {
  const navigation = useNavigation<any>();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Your AI workforce"
      onPress={() => navigation.navigate('AiAgents')}
      style={styles.pill}
      activeOpacity={0.85}
    >
      <Text style={styles.label}>AI WORKFORCE</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 30,
    marginRight: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E9D93B',
    backgroundColor: '#FBE618',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: '#0A0B0D', fontSize: 11, fontWeight: '800' },
});
