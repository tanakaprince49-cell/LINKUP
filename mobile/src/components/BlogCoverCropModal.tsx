import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, Crop, Maximize2, Minus, Move, Plus, RotateCcw, X } from 'lucide-react-native';
import { computeCoverCropRect, RawCoverAsset } from '../lib/blogs';

type Props = {
  visible: boolean;
  asset: RawCoverAsset | null;
  saving: boolean;
  isDark: boolean;
  onCancel: () => void;
  onConfirm: (params: {
    mode: 'fill' | 'fit';
    stageW: number;
    stageH: number;
    zoom: number;
    panX: number;
    panY: number;
  }) => void;
};

const ZOOM_PRESETS = [1, 1.25, 1.5, 2, 2.5, 3];

export default function BlogCoverCropModal({
  visible,
  asset,
  saving,
  isDark,
  onCancel,
  onConfirm,
}: Props) {
  const [mode, setMode] = useState<'fill' | 'fit'>('fill');
  const [stageW, setStageW] = useState(320);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const panRef = useRef({ x: 0, y: 0 });
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const webDraggingRef = useRef(false);
  const webStartClientRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (visible && asset) {
      setMode('fill');
      setZoom(1);
      setPan({ x: 0, y: 0 });
      panRef.current = { x: 0, y: 0 };
    }
  }, [visible, asset]);

  const stageH = Math.max(90, Math.round((stageW * 9) / 16));

  const cropState = useMemo(() => {
    return computeCoverCropRect({
      imgW: asset?.width || 1280,
      imgH: asset?.height || 720,
      stageW,
      stageH,
      zoom,
      panX: pan.x,
      panY: pan.y,
    });
  }, [asset?.width, asset?.height, stageW, stageH, zoom, pan.x, pan.y]);

  const applyClampedPan = (nextX: number, nextY: number, nextZoom = zoom) => {
    const computed = computeCoverCropRect({
      imgW: asset?.width || 1280,
      imgH: asset?.height || 720,
      stageW,
      stageH,
      zoom: nextZoom,
      panX: nextX,
      panY: nextY,
    });
    const clamped = { x: computed.clampedPanX, y: computed.clampedPanY };
    panRef.current = clamped;
    setPan(clamped);
  };

  const updateZoom = (nextZoomRaw: number) => {
    const nextZoom = Math.max(1, Math.min(3.5, Math.round(nextZoomRaw * 100) / 100));
    setZoom(nextZoom);
    applyClampedPan(panRef.current.x, panRef.current.y, nextZoom);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => mode === 'fill' && !saving,
        onMoveShouldSetPanResponder: () => mode === 'fill' && !saving,
        onPanResponderGrant: () => {
          dragOriginRef.current = { ...panRef.current };
        },
        onPanResponderMove: (_evt, gestureState) => {
          applyClampedPan(
            dragOriginRef.current.x + gestureState.dx,
            dragOriginRef.current.y + gestureState.dy
          );
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, saving, asset?.width, asset?.height, stageW, stageH, zoom]
  );

  // Additional smooth desktop mouse/pointer support on web so browser never drags <img>
  const webPointerProps: any =
    Platform.OS === 'web'
      ? {
          onPointerDown: (e: any) => {
            if (mode !== 'fill' || saving) return;
            e.preventDefault?.();
            e.currentTarget?.setPointerCapture?.(e.pointerId);
            webDraggingRef.current = true;
            dragOriginRef.current = { ...panRef.current };
            webStartClientRef.current = { x: e.clientX || 0, y: e.clientY || 0 };
          },
          onPointerMove: (e: any) => {
            if (!webDraggingRef.current || mode !== 'fill' || saving) return;
            e.preventDefault?.();
            const dx = (e.clientX || 0) - webStartClientRef.current.x;
            const dy = (e.clientY || 0) - webStartClientRef.current.y;
            applyClampedPan(dragOriginRef.current.x + dx, dragOriginRef.current.y + dy);
          },
          onPointerUp: (e: any) => {
            webDraggingRef.current = false;
            e.currentTarget?.releasePointerCapture?.(e.pointerId);
          },
          onPointerCancel: () => {
            webDraggingRef.current = false;
          },
          onWheel: (e: any) => {
            if (mode !== 'fill' || saving) return;
            e.preventDefault?.();
            const delta = e.deltaY < 0 ? 0.12 : -0.12;
            updateZoom(zoom + delta);
          },
        }
      : {};

  if (!visible || !asset) return null;

  const surfaceBg = isDark ? '#161920' : '#FFFFFF';
  const borderCol = isDark ? '#2E333E' : '#E2DFD5';
  const ink = isDark ? '#F9FAFB' : '#0A0B0D';
  const sub = isDark ? '#9CA3AF' : '#57534E';
  const sourceUri = asset.dataUri || asset.uri;

  const imgLeft = (stageW - cropState.dispW) / 2 + cropState.clampedPanX;
  const imgTop = (stageH - cropState.dispH) / 2 + cropState.clampedPanY;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: surfaceBg, borderColor: borderCol }]}>
          <View style={[styles.header, { borderBottomColor: borderCol }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Crop size={18} color={ink} />
              <Text style={[styles.title, { color: ink }]}>Crop Cover Image (16:9)</Text>
            </View>
            <TouchableOpacity
              onPress={onCancel}
              disabled={saving}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Cancel crop"
            >
              <X size={18} color={sub} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            {/* Mode Switch: Crop to Fill vs Fit Full Picture */}
            <View style={[styles.modeRow, { backgroundColor: isDark ? '#222631' : '#F1EFE8' }]}>
              <TouchableOpacity
                onPress={() => setMode('fill')}
                disabled={saving}
                style={[styles.modeBtn, mode === 'fill' && styles.modeBtnActive]}
                accessibilityRole="button"
              >
                <Crop size={14} color={mode === 'fill' ? '#0A0B0D' : sub} />
                <Text
                  style={[
                    styles.modeBtnText,
                    { color: mode === 'fill' ? '#0A0B0D' : sub },
                  ]}
                >
                  Crop & Frame (16:9)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setMode('fit')}
                disabled={saving}
                style={[styles.modeBtn, mode === 'fit' && styles.modeBtnActive]}
                accessibilityRole="button"
              >
                <Maximize2 size={14} color={mode === 'fit' ? '#0A0B0D' : sub} />
                <Text
                  style={[
                    styles.modeBtnText,
                    { color: mode === 'fit' ? '#0A0B0D' : sub },
                  ]}
                >
                  Fit Full Picture
                </Text>
              </TouchableOpacity>
            </View>

            {/* Interactive 16:9 Crop Stage */}
            <View
              onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                if (w > 40 && w !== stageW) setStageW(w);
              }}
              style={[
                styles.stage,
                {
                  height: stageH,
                  cursor: mode === 'fill' ? 'grab' : 'default',
                  touchAction: 'none',
                  userSelect: 'none',
                } as any,
              ]}
              {...(Platform.OS === 'web' ? webPointerProps : panResponder.panHandlers)}
            >
              {mode === 'fill' ? (
                <>
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: imgLeft,
                      top: imgTop,
                      width: cropState.dispW,
                      height: cropState.dispH,
                    }}
                  >
                    <Image
                      source={{ uri: sourceUri }}
                      resizeMode="stretch"
                      style={{ width: '100%', height: '100%' }}
                    />
                  </View>
                  {/* Rule of thirds framing grid */}
                  <View pointerEvents="none" style={styles.gridOverlay}>
                    <View style={[styles.gridLineV, { left: '33.33%' }]} />
                    <View style={[styles.gridLineV, { left: '66.66%' }]} />
                    <View style={[styles.gridLineH, { top: '33.33%' }]} />
                    <View style={[styles.gridLineH, { top: '66.66%' }]} />
                  </View>
                  <View pointerEvents="none" style={styles.dragHintPill}>
                    <Move size={12} color="#FFFFFF" />
                    <Text style={styles.dragHintText}>Drag to reposition</Text>
                  </View>
                </>
              ) : (
                <View pointerEvents="none" style={{ width: '100%', height: '100%' }}>
                  <Image
                    source={{ uri: sourceUri }}
                    resizeMode="contain"
                    style={{ width: '100%', height: '100%' }}
                  />
                </View>
              )}
            </View>

            {mode === 'fill' ? (
              <View style={styles.zoomSection}>
                <View style={styles.zoomHeader}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: sub }}>
                    Zoom ({zoom.toFixed(2).replace(/\.00$/, '×').replace(/(\.\d)0$/, '$1×')}
                    {zoom.toFixed(2).endsWith('0') ? '' : '×'})
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setZoom(1);
                      panRef.current = { x: 0, y: 0 };
                      setPan({ x: 0, y: 0 });
                    }}
                    disabled={saving}
                    style={styles.resetBtn}
                  >
                    <RotateCcw size={12} color={sub} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: sub }}>Reset</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.zoomControls}>
                  <TouchableOpacity
                    onPress={() => updateZoom(zoom - 0.15)}
                    disabled={saving || zoom <= 1}
                    style={[styles.stepBtn, { borderColor: borderCol }]}
                    accessibilityRole="button"
                    accessibilityLabel="Zoom out"
                  >
                    <Minus size={15} color={ink} />
                  </TouchableOpacity>

                  <View style={styles.presetRow}>
                    {ZOOM_PRESETS.map((preset) => {
                      const active = Math.abs(zoom - preset) < 0.08;
                      return (
                        <TouchableOpacity
                          key={preset}
                          onPress={() => updateZoom(preset)}
                          disabled={saving}
                          style={[
                            styles.presetChip,
                            {
                              backgroundColor: active
                                ? '#FBE618'
                                : isDark
                                  ? '#252A36'
                                  : '#EEECE4',
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '800',
                              color: active ? '#0A0B0D' : ink,
                            }}
                          >
                            {preset}×
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    onPress={() => updateZoom(zoom + 0.15)}
                    disabled={saving || zoom >= 3.5}
                    style={[styles.stepBtn, { borderColor: borderCol }]}
                    accessibilityRole="button"
                    accessibilityLabel="Zoom in"
                  >
                    <Plus size={15} color={ink} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Text style={{ fontSize: 12, color: sub, textAlign: 'center' }}>
                Your entire image fits inside the 16:9 cover frame without cutting off any edges.
              </Text>
            )}
          </View>

          <View style={[styles.footer, { borderTopColor: borderCol }]}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={saving}
              style={[styles.cancelBtn, { backgroundColor: isDark ? '#252A36' : '#ECEAE2' }]}
            >
              <Text style={{ fontWeight: '800', fontSize: 13, color: ink }}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() =>
                onConfirm({
                  mode,
                  stageW,
                  stageH,
                  zoom,
                  panX: cropState.clampedPanX,
                  panY: cropState.clampedPanY,
                })
              }
              disabled={saving}
              style={[styles.confirmBtn, saving && { opacity: 0.7 }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#0A0B0D" />
              ) : (
                <Check size={16} color="#0A0B0D" />
              )}
              <Text style={styles.confirmBtnText}>
                {saving ? 'Applying Crop…' : 'Apply Crop & Upload'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 11, 13, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  dialog: {
    width: '100%',
    maxWidth: 620,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 16,
    gap: 14,
  },
  modeRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
  },
  modeBtnActive: {
    backgroundColor: '#FBE618',
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  stage: {
    width: '100%',
    backgroundColor: '#111318',
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: '#FBE618',
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dragHintPill: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(10,11,13,0.68)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dragHintText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  zoomSection: {
    gap: 8,
  },
  zoomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FBE618',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0A0B0D',
  },
});
