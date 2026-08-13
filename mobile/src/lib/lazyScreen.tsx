import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { COLORS } from '../theme/theme';

export function lazyScreen(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  let cached: React.ComponentType<any> | null = null;
  let pending: Promise<void> | null = null;

  const preload = () => {
    if (cached || pending) return pending;
    pending = loader().then((mod) => {
      cached = mod.default;
    });
    return pending;
  };

  function LazyRoute(props: any) {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      if (cached) return;
      void preload()?.then(() => bump((n) => n + 1));
    }, []);
    if (!cached) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0B0B' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      );
    }
    const Screen = cached;
    return <Screen {...props} />;
  }

  LazyRoute.preload = preload;
  return LazyRoute;
}
