import React from 'react';
import { Image, StyleSheet, View, ViewStyle } from 'react-native';

const logo = require('../../assets/logo-square.png');

interface BrandMarkProps {
  size?: number;
  style?: ViewStyle;
}

export default function BrandMark({ size = 24, style }: BrandMarkProps) {
  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size * 0.25 }, style]}>
      <Image source={logo} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
