import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { COLORS } from '../theme/theme';

interface Props {
  children: React.ReactNode;
  /** Optional screen label shown in error UI */
  screenName?: string;
  /** If true, renders a minimal inline error instead of full-screen */
  inline?: boolean;
}

interface State {
  hasError: boolean;
  error: string;
}

/**
 * Catches unhandled React render errors and shows a recovery UI.
 * This is critical for iOS Safari / Chrome where any unhandled JS error
 * causes a white screen with no indication of failure.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    return { hasError: true, error: message.slice(0, 300) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Log full error in dev
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error, info);
    } else {
      console.warn('[ErrorBoundary] Screen crash caught:', String(error).slice(0, 200));
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: '' });
  };

  handleGoHome = () => {
    try {
      if (Platform.OS === 'web') {
        (globalThis as any)?.location?.assign?.('/');
      }
    } catch {
      // noop
    }
  };

  render() {
    const { hasError, error } = this.state;
    const { children, screenName, inline } = this.props;

    if (!hasError) return children as React.ReactElement;

    if (inline) {
      return (
        <View style={styles.inlineWrap}>
          <Text style={styles.inlineText}>
            {screenName ? `${screenName} failed to load.` : 'Content failed to load.'}
          </Text>
          <TouchableOpacity onPress={this.handleRetry} style={styles.inlineBtn}>
            <Text style={styles.inlineBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.fullWrap}>
        <View style={styles.card}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>
            {screenName ? `${screenName} crashed` : 'Something went wrong'}
          </Text>
          <Text style={styles.subtitle}>
            This page encountered an error. You can retry or go back to the home screen.
          </Text>
          {__DEV__ && error ? (
            <View style={styles.devError}>
              <Text style={styles.devErrorText}>{error}</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <TouchableOpacity onPress={this.handleRetry} style={[styles.btn, styles.retryBtn]}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
            {Platform.OS === 'web' && (
              <TouchableOpacity onPress={this.handleGoHome} style={[styles.btn, styles.homeBtn]}>
                <Text style={styles.homeBtnText}>Go Home</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fullWrap: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  emoji: {
    fontSize: 40,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  devError: {
    backgroundColor: 'rgba(255,50,50,0.12)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    width: '100%',
  },
  devErrorText: {
    fontSize: 11,
    color: '#FF6B6B',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 100,
    alignItems: 'center',
  },
  retryBtn: {
    backgroundColor: COLORS.primary,
  },
  retryBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 14,
  },
  homeBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  homeBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  inlineWrap: {
    padding: 16,
    alignItems: 'center',
    gap: 10,
  },
  inlineText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    textAlign: 'center',
  },
  inlineBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  inlineBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
});
