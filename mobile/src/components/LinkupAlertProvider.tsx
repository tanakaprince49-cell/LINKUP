import React from 'react';
import {
  Alert,
  AlertButton,
  AlertOptions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS, hairline, textColor } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';

type LinkupAlertPayload = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

const normalizeButtons = (buttons?: AlertButton[]) => {
  if (Array.isArray(buttons) && buttons.length > 0) return buttons;
  return [{ text: 'OK', style: 'default' as const }];
};

export default function LinkupAlertProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [queue, setQueue] = React.useState<LinkupAlertPayload[]>([]);
  const current = queue[0] || null;
  const alertIdRef = React.useRef(0);
  const originalAlertRef = React.useRef<typeof Alert.alert | null>(null);

  const dismissCurrent = React.useCallback((button?: AlertButton) => {
    setQueue((items) => items.slice(1));
    setTimeout(() => {
      button?.onPress?.();
    }, 40);
  }, []);

  const dismissFromBackdrop = React.useCallback(() => {
    if (!current || current.options?.cancelable === false) return;
    setQueue((items) => items.slice(1));
    setTimeout(() => {
      current.options?.onDismiss?.();
    }, 40);
  }, [current]);

  React.useEffect(() => {
    if (!originalAlertRef.current) {
      originalAlertRef.current = Alert.alert;
    }

    const themedAlert: typeof Alert.alert = (title, message, buttons, options) => {
      const payload: LinkupAlertPayload = {
        id: alertIdRef.current + 1,
        title: String(title || 'LINKUP'),
        message: typeof message === 'string' ? message : undefined,
        buttons: normalizeButtons(buttons),
        options,
      };
      alertIdRef.current = payload.id;
      setQueue((items) => [...items, payload]);
    };

    Alert.alert = themedAlert;

    return () => {
      if (Alert.alert === themedAlert && originalAlertRef.current) {
        Alert.alert = originalAlertRef.current;
      }
    };
  }, []);

  const visibleButtons = current?.buttons || [];
  const stacked = visibleButtons.length > 2;

  return (
    <>
      {children}
      <Modal
        transparent
        visible={!!current}
        animationType="fade"
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={dismissFromBackdrop}
      >
        <Pressable style={styles.backdrop} onPress={dismissFromBackdrop}>
          <Pressable
            style={[
              styles.card,
              {
                backgroundColor: isDark ? COLORS.darkCard : '#FFFFFF',
                borderColor: hairline(isDark),
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.title, { color: textColor(isDark) }]}>{current?.title || 'LINKUP'}</Text>
            {current?.message ? (
              <Text style={[styles.message, { color: textColor(isDark, 'secondary') }]}>{current.message}</Text>
            ) : null}

            <View style={[styles.actions, stacked && styles.actionsStacked]}>
              {visibleButtons.map((button, index) => {
                const isCancel = button.style === 'cancel';
                const isDestructive = button.style === 'destructive';
                const isPrimary = !isCancel && !isDestructive && index === visibleButtons.length - 1;
                return (
                  <TouchableOpacity
                    key={`${current?.id || 'alert'}-${button.text || 'button'}-${index}`}
                    activeOpacity={0.85}
                    style={[
                      styles.actionButton,
                      stacked && styles.stackedAction,
                      { borderColor: hairline(isDark) },
                      isPrimary && styles.primaryButton,
                      isDestructive && styles.destructiveButton,
                    ]}
                    onPress={() => dismissCurrent(button)}
                  >
                    <Text
                      style={[
                        styles.actionText,
                        { color: textColor(isDark) },
                        isPrimary && styles.primaryText,
                        isCancel && { color: textColor(isDark, 'secondary') },
                        isDestructive && styles.destructiveText,
                      ]}
                      numberOfLines={2}
                    >
                      {button.text || 'OK'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  message: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  actionsStacked: {
    flexDirection: 'column',
  },
  actionButton: {
    minHeight: 40,
    minWidth: 72,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackedAction: {
    width: '100%',
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.lightBorderActive,
  },
  destructiveButton: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(225,29,72,0.35)',
  },
  actionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  primaryText: {
    color: '#111',
  },
  destructiveText: {
    color: COLORS.danger,
  },
});
