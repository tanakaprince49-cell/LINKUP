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
import { Bell, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';

type LinkupAlertPayload = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

const normalizeButtons = (buttons?: AlertButton[]) => {
  if (Array.isArray(buttons) && buttons.length > 0) {
    return buttons;
  }
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
  const stackedButtons = visibleButtons.length > 2;

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
                backgroundColor: isDark ? '#111114' : '#FFFFFF',
                borderColor: '#FBE618',
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.brandBand}>
              <View style={styles.brandIcon}>
                <Bell size={19} color="#000" strokeWidth={2.8} />
              </View>
              <View style={styles.brandCopy}>
                <Text style={styles.brandText}>LINKUP</Text>
                <Text style={styles.brandSubtext}>NOTICE</Text>
              </View>
              {current?.options?.cancelable === false ? null : (
                <TouchableOpacity style={styles.closeButton} onPress={dismissFromBackdrop} activeOpacity={0.85}>
                  <X size={18} color="#000" strokeWidth={3} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.body}>
              <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                {current?.title || 'LINKUP'}
              </Text>
              {current?.message ? (
                <Text style={[styles.message, { color: isDark ? '#D7D7D7' : '#333333' }]}>
                  {current.message}
                </Text>
              ) : null}
            </View>

            <View style={[styles.actions, stackedButtons && styles.actionsStacked]}>
              {visibleButtons.map((button, index) => {
                const isCancel = button.style === 'cancel';
                const isDestructive = button.style === 'destructive';
                const isPrimary = !isCancel && !isDestructive && index === visibleButtons.length - 1;
                return (
                  <TouchableOpacity
                    key={`${current?.id || 'alert'}-${button.text || 'button'}-${index}`}
                    activeOpacity={0.86}
                    style={[
                      styles.actionButton,
                      stackedButtons && styles.stackedActionButton,
                      isPrimary && styles.primaryButton,
                      isCancel && styles.cancelButton,
                      isDestructive && styles.destructiveButton,
                    ]}
                    onPress={() => dismissCurrent(button)}
                  >
                    <Text
                      style={[
                        styles.actionText,
                        isPrimary && styles.primaryText,
                        isCancel && styles.cancelText,
                        isDestructive && styles.destructiveText,
                      ]}
                      numberOfLines={2}
                      adjustsFontSizeToFit
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
    backgroundColor: 'rgba(0,0,0,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 410,
    borderRadius: 28,
    borderWidth: 2,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 20,
  },
  brandBand: {
    minHeight: 72,
    backgroundColor: '#FBE618',
    borderBottomWidth: 2,
    borderBottomColor: '#000',
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
  },
  brandText: {
    fontSize: 18,
    lineHeight: 21,
    color: '#000',
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 1.6,
  },
  brandSubtext: {
    marginTop: 1,
    fontSize: 9,
    color: '#000',
    fontWeight: '900',
    letterSpacing: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: 0,
  },
  message: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
  },
  actionsStacked: {
    flexDirection: 'column',
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#000',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stackedActionButton: {
    flex: 0,
    width: '100%',
  },
  primaryButton: {
    backgroundColor: '#FBE618',
    borderColor: '#000',
  },
  cancelButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D6D6D6',
  },
  destructiveButton: {
    backgroundColor: '#FFF1F1',
    borderColor: '#FFB4B4',
  },
  actionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 0.7,
    color: '#000',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  primaryText: {
    color: '#000',
  },
  cancelText: {
    color: '#333333',
  },
  destructiveText: {
    color: '#B42318',
  },
});
