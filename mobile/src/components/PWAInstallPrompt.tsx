import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Download, X } from 'lucide-react-native';

const DISMISSED_KEY = 'linkup:pwa-install-dismissed';

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    setDismissed(window.localStorage?.getItem(DISMISSED_KEY) === 'true');

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
    };

    const handleInstalled = () => {
      setInstallEvent(null);
      window.localStorage?.setItem(DISMISSED_KEY, 'true');
      setDismissed(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (Platform.OS !== 'web' || dismissed || !installEvent) return null;

  const install = async () => {
    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') {
      window.localStorage?.setItem(DISMISSED_KEY, 'true');
      setDismissed(true);
    }
    setInstallEvent(null);
  };

  const dismiss = () => {
    window.localStorage?.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
    setInstallEvent(null);
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={install} style={styles.installButton} activeOpacity={0.9}>
        <Download size={16} color="#000" />
        <Text style={styles.installText}>INSTALL LINKUP</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={dismiss} style={styles.closeButton} activeOpacity={0.8}>
        <X size={14} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    right: 18,
    bottom: 104,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  installButton: {
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FBE618',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  installText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#000',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#111115',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
