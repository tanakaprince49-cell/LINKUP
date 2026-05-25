import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Check } from 'lucide-react-native';

type VerifiedBadgeProps = {
  size?: number;
  color?: string;
  style?: ViewStyle;
};

export default function VerifiedBadge({ size = 22, color = '#0A84FF', style }: VerifiedBadgeProps) {
  const raySize = Math.max(4, size * 0.24);
  const coreInset = size * 0.12;
  const radius = size * 0.39;
  const center = size / 2;
  const rays = Array.from({ length: 14 }, (_, index) => {
    const angle = (index / 14) * Math.PI * 2;
    return {
      left: center + Math.cos(angle) * radius - raySize / 2,
      top: center + Math.sin(angle) * radius - raySize / 2,
    };
  });

  return (
    <View style={[styles.root, { width: size, height: size }, style]} accessibilityLabel="Verified">
      {rays.map((ray, index) => (
        <View
          key={index}
          style={[
            styles.ray,
            {
              width: raySize,
              height: raySize,
              borderRadius: raySize / 2,
              left: ray.left,
              top: ray.top,
              backgroundColor: color,
            },
          ]}
        />
      ))}
      <View
        style={[
          styles.core,
          {
            left: coreInset,
            top: coreInset,
            width: size - coreInset * 2,
            height: size - coreInset * 2,
            borderRadius: (size - coreInset * 2) / 2,
            backgroundColor: color,
          },
        ]}
      />
      <Check
        size={size * 0.55}
        color="#FFFFFF"
        strokeWidth={4}
        style={[
          styles.check,
          {
            left: size * 0.225,
            top: size * 0.225,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0A84FF',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  ray: {
    position: 'absolute',
  },
  core: {
    position: 'absolute',
  },
  check: {
    position: 'absolute',
  },
});
