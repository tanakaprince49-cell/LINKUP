import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import VerifiedBadge from './VerifiedBadge';
import { agentPhoto } from '../lib/agentAssets';

/**
 * An agent's identity in one glance: real profile photo, LINKUP's verified
 * blue tick, and — when there's room — the AI tag. Agents never borrow the
 * visual language of humans without the label attached.
 */
export default function AgentAvatar({
  agentId,
  name,
  size = 48,
  tick = true,
}: {
  agentId?: string;
  name?: string;
  size?: number;
  tick?: boolean;
}) {
  const photo = agentPhoto(agentId);
  const tickSize = Math.max(16, Math.round(size * 0.42));
  return (
    <View style={{ width: size, height: size }}>
      {photo ? (
        <Image source={photo} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={{ color: '#0A0B0D', fontWeight: '800', fontSize: size * 0.38 }}>
            {String(name || 'A').slice(0, 1)}
          </Text>
        </View>
      )}
      {tick && (
        <View style={{ position: 'absolute', right: -3, bottom: -3 }}>
          <VerifiedBadge size={tickSize} accessibilityLabel={`Verified AI agent${name ? ` — ${name}` : ''}`} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: '#FBE618', alignItems: 'center', justifyContent: 'center' },
});
