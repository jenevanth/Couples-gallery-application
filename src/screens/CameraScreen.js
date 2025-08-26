import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  Pressable,
  Dimensions,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useIsFocused, useFocusEffect } from '@react-navigation/native';
import {
  Camera,
  useCameraDevice,
  useCameraDevices,
} from 'react-native-vision-camera';
import Slider from '@react-native-community/slider';
import Video from 'react-native-video';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabase';
import BlobUtil from 'react-native-blob-util';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS } from '../theme/colors';

// Optional: device screen brightness (safe, optional)
let ScreenBrightness = null;
try {
  ScreenBrightness = require('react-native-screen-brightness').default;
} catch (e) {
  console.log(
    '[Camera] ScreenBrightness not installed; using light bars only.',
  );
}

const log = (...a) => console.log('[Camera]', ...a);
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const ASPECTS = [
  { key: 'full', label: 'FULL', ratio: 0 }, // fill height
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
];

const TIMERS = [0, 3, 10];
const FPS_CHOICES = [24, 30, 60];

const CameraScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  const camera = useRef(null);
  const [hasPermission, setHasPermission] = useState(null);
  const [hasMicPermission, setHasMicPermission] = useState(null);

  // Capture states
  const [photo, setPhoto] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState('me');
  const [cameraPosition, setCameraPosition] = useState('back');
  const [flashMode, setFlashMode] = useState('off'); // 'off' | 'flash' | 'torch'

  // Mode
  const [mode, setMode] = useState('photo'); // 'photo' | 'video'
  const [isRecording, setIsRecording] = useState(false);
  const recordTimerRef = useRef(null);
  const [recordSecs, setRecordSecs] = useState(0);

  // Controls
  const [zoom, setZoom] = useState(1);
  const [aspectKey, setAspectKey] = useState('full');
  const [showGrid, setShowGrid] = useState(false);
  const [ev, setEv] = useState(0);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState(0);

  // Tap to focus UI
  const [focusUI, setFocusUI] = useState({ visible: false, x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const [camLayout, setCamLayout] = useState({
    w: SCREEN_WIDTH,
    h: SCREEN_HEIGHT,
  });

  // Pinch-to-zoom (no deps)
  const [pinchActive, setPinchActive] = useState(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartZoomRef = useRef(1);

  // Formats & FPS selection
  const device = useCameraDevice(cameraPosition);
  const devicesList = useCameraDevices();
  const [bestPhotoFormat, setBestPhotoFormat] = useState(null);
  const [bestVideoFormat, setBestVideoFormat] = useState(null);
  const [videoFps, setVideoFps] = useState(30);
  const [videoFpsRange, setVideoFpsRange] = useState({ min: 1, max: 60 });

  // Selfie light (edge bars + optional screen boost)
  const [selfieLight, setSelfieLight] = useState(false);
  const [selfieIntensity, setSelfieIntensity] = useState(0.85); // 0..1
  const [lowLightPreset, setLowLightPreset] = useState(false);
  const [autoLowLightFront, setAutoLowLightFront] = useState(true); // Auto fallback to 24fps on front video
  const origBrightnessRef = useRef(null);

  // Hide tab bar on this screen
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent?.();
      parent?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => parent?.setOptions({ tabBarStyle: undefined });
    }, [navigation]),
  );

  const shutterColor =
    profile === 'me' ? COLORS.blue.primary : COLORS.pink.primary;

  // Log devices + init zoom
  useEffect(() => {
    const list = Array.isArray(devicesList)
      ? devicesList
      : devicesList
      ? Object.values(devicesList)
      : [];
    log(
      'Devices:',
      list.map(d => ({
        pos: d.position,
        id: d.id,
        name: d.name,
        hasFlash: d.hasFlash,
        minZoom: d.minZoom,
        maxZoom: d.maxZoom,
        neutralZoom: d.neutralZoom,
        formats: d.formats?.length,
      })),
    );
    if (!device && list.length) {
      const hasBack = list.some(d => d.position === 'back');
      const hasFront = list.some(d => d.position === 'front');
      if (cameraPosition === 'back' && !hasBack && hasFront) {
        log('Auto-switch → front (no back cam)');
        setCameraPosition('front');
      } else if (cameraPosition === 'front' && !hasFront && hasBack) {
        log('Auto-switch → back (no front cam)');
        setCameraPosition('back');
      }
    } else if (device) {
      log('Using device:', {
        pos: device.position,
        id: device.id,
        name: device.name,
        hasFlash: device.hasFlash,
        minZoom: device.minZoom,
        maxZoom: device.maxZoom,
        neutralZoom: device.neutralZoom,
        formats: device.formats?.length,
      });
      const startZoom =
        typeof device.neutralZoom === 'number'
          ? device.neutralZoom
          : typeof device.minZoom === 'number'
          ? device.minZoom
          : 1;
      setZoom(startZoom);
    }
  }, [devicesList, device, cameraPosition]);

  // Auth + current profile
  useEffect(() => {
    (async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) log('getUser error:', error);
      setUserId(user?.id || '');
      log('userId:', user?.id);

      if (user?.id) {
        const { data: prof, error: pErr } = await supabase
          .from('profiles')
          .select('current_profile')
          .eq('id', user.id)
          .single();
        if (pErr) log('profiles fetch error:', pErr);
        setProfile(prof?.current_profile || 'me');
        log('Loaded profile:', prof?.current_profile);
      }
    })();
  }, []);

  // Permissions
  useEffect(() => {
    (async () => {
      try {
        const camStatus = await Camera.getCameraPermissionStatus();
        log('Initial camera perm:', camStatus);
        if (camStatus !== 'authorized' && camStatus !== 'granted') {
          const req = await Camera.requestCameraPermission();
          setHasPermission(req === 'authorized' || req === 'granted');
          log('Camera permission requested ->', req);
        } else setHasPermission(true);

        const micStatus = await Camera.getMicrophonePermissionStatus();
        log('Initial mic perm:', micStatus);
        if (micStatus !== 'authorized' && micStatus !== 'granted') {
          const reqM = await Camera.requestMicrophonePermission();
          setHasMicPermission(reqM === 'authorized' || reqM === 'granted');
          log('Microphone permission requested ->', reqM);
        } else setHasMicPermission(true);
      } catch (e) {
        setHasPermission(false);
        setHasMicPermission(false);
        log('Permission error:', e);
      }
    })();
  }, []);

  // Format selection helpers
  const getFpsRange = useCallback(f => {
    let min = 1,
      max = 60;
    if (!f) return { min, max };
    if (typeof f.minFps === 'number') min = f.minFps;
    if (typeof f.maxFps === 'number') max = f.maxFps;
    if (Array.isArray(f.frameRateRanges) && f.frameRateRanges.length) {
      const mins = f.frameRateRanges.map(r => r.minFrameRate || r.minFps || 1);
      const maxs = f.frameRateRanges.map(r => r.maxFrameRate || r.maxFps || 60);
      min = Math.min(...mins);
      max = Math.max(...maxs);
    }
    return { min, max };
  }, []);

  const pickFormats = useCallback(
    dev => {
      if (!dev?.formats?.length) {
        log('No formats available for device.');
        setBestPhotoFormat(null);
        setBestVideoFormat(null);
        return;
      }
      let pf = null,
        pfArea = 0;
      let vf = null,
        vfScore = 0;

      for (const f of dev.formats) {
        const pW =
          f?.photoWidth ?? f?.photo?.width ?? f?.photoDimensions?.width ?? 0;
        const pH =
          f?.photoHeight ?? f?.photo?.height ?? f?.photoDimensions?.height ?? 0;
        const vW =
          f?.videoWidth ?? f?.video?.width ?? f?.videoDimensions?.width ?? 0;
        const vH =
          f?.videoHeight ?? f?.video?.height ?? f?.videoDimensions?.height ?? 0;

        const pArea = (pW || 0) * (pH || 0);
        const vArea = (vW || 0) * (vH || 0);
        if (pArea > pfArea) {
          pf = f;
          pfArea = pArea;
        }

        const { min, max } = getFpsRange(f);
        const can30 = min <= 30 && max >= 30;
        const score = vArea + (can30 ? 1 : 0);
        if (score > vfScore) {
          vf = f;
          vfScore = score;
        }
      }

      setBestPhotoFormat(pf || null);
      setBestVideoFormat(vf || null);

      const vr = getFpsRange(vf || {});
      setVideoFpsRange(vr);

      // Default FPS: prefer 30, but if front camera tends to be dark, default to 24
      const defaultFps = cameraPosition === 'front' ? 24 : 30;
      const clamped = clamp(defaultFps, vr.min, vr.max);
      setVideoFps(clamped);

      log('Picked formats:', {
        photo: {
          w: pf?.photoWidth ?? pf?.photo?.width ?? pf?.photoDimensions?.width,
          h:
            pf?.photoHeight ?? pf?.photo?.height ?? pf?.photoDimensions?.height,
        },
        video: {
          w: vf?.videoWidth ?? vf?.video?.width ?? vf?.videoDimensions?.width,
          h:
            vf?.videoHeight ?? vf?.video?.height ?? vf?.videoDimensions?.height,
          fpsRange: vr,
          defaultFps: clamped,
        },
      });
    },
    [getFpsRange, cameraPosition],
  );

  useEffect(() => {
    if (device) pickFormats(device);
  }, [device, pickFormats]);

  const cycleFlash = () => {
    setFlashMode(prev => {
      const next =
        prev === 'off' ? 'flash' : prev === 'flash' ? 'torch' : 'off';
      log('Flash mode:', next);
      return next;
    });
  };

  const switchCamera = () => {
    setCameraPosition(prev => {
      const next = prev === 'back' ? 'front' : 'back';
      log('Switching camera to:', next);
      return next;
    });
  };

  const quickZoomToggle = () => {
    const neutral =
      typeof device?.neutralZoom === 'number' ? device.neutralZoom : 1;
    const target = zoom < neutral * 1.9 ? neutral * 2 : neutral;
    const minZ = typeof device?.minZoom === 'number' ? device.minZoom : 1;
    const maxZ = typeof device?.maxZoom === 'number' ? device.maxZoom : 4;
    setZoom(clamp(target, minZ, maxZ));
    log('Quick zoom toggle:', { neutral, target });
  };

  const applyExposure = async val => {
    setEv(val);
    try {
      if (camera.current?.setExposure) {
        await camera.current.setExposure(val);
        log('setExposure applied:', val);
      } else if (camera.current?.setExposureCompensation) {
        await camera.current.setExposureCompensation(val);
        log('setExposureCompensation applied:', val);
      } else {
        log(
          'Exposure not supported on this device; using physical light if needed.',
        );
      }
    } catch (e) {
      log('Exposure apply error:', e);
    }
  };

  const getCameraHeight = () => {
    const aspect = ASPECTS.find(a => a.key === aspectKey);
    if (!aspect || aspect.ratio <= 0) return SCREEN_HEIGHT;
    return SCREEN_WIDTH / aspect.ratio;
  };

  const handleTap = async evt => {
    const now = Date.now();
    const doubleTap = now - (lastTapRef.current || 0) < 300;
    lastTapRef.current = now;

    const { locationX, locationY } = evt.nativeEvent;
    if (!camLayout.w || !camLayout.h) return;

    const xNorm = clamp(locationX / camLayout.w, 0, 1);
    const yNorm = clamp(locationY / camLayout.h, 0, 1);

    if (doubleTap) {
      quickZoomToggle();
      return;
    }

    setFocusUI({ visible: true, x: locationX, y: locationY });
    setTimeout(() => setFocusUI(f => ({ ...f, visible: false })), 1500);

    try {
      if (camera.current?.focus) {
        await camera.current.focus({ x: xNorm, y: yNorm });
        log('Focus at:', { xNorm, yNorm });
      } else {
        log('focus() not supported in this build.');
      }
      if (camera.current?.setExposurePoint) {
        await camera.current.setExposurePoint({ x: xNorm, y: yNorm });
        log('Exposure point at:', { xNorm, yNorm });
      } else {
        log('setExposurePoint() not supported in this build.');
      }
    } catch (e) {
      log('Tap focus/expose error:', e);
    }
  };

  // Pinch-to-zoom without libs
  const distance2 = (t1, t2) => {
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onStartShouldSetResponder = e => {
    const t = e.nativeEvent.touches;
    return t && t.length >= 2; // only capture when multi-touch
  };
  const onMoveShouldSetResponder = e => {
    const t = e.nativeEvent.touches;
    return t && t.length >= 2;
  };

  const onResponderGrant = e => {
    const t = e.nativeEvent.touches;
    if (t && t.length >= 2) {
      pinchStartDistRef.current = distance2(t[0], t[1]);
      pinchStartZoomRef.current = zoom;
      setPinchActive(true);
      log('Pinch start:', {
        dist: pinchStartDistRef.current,
        zoomStart: pinchStartZoomRef.current,
      });
    }
  };

  const onResponderMove = e => {
    const t = e.nativeEvent.touches;
    if (!pinchActive || !t || t.length < 2) return;
    const dist = distance2(t[0], t[1]);
    if (pinchStartDistRef.current > 0) {
      const scale = dist / pinchStartDistRef.current;
      const minZ = typeof device?.minZoom === 'number' ? device.minZoom : 1;
      const maxZ = typeof device?.maxZoom === 'number' ? device.maxZoom : 4;
      const newZoom = clamp(pinchStartZoomRef.current * scale, minZ, maxZ);
      setZoom(newZoom);
    }
  };

  const onResponderRelease = () => {
    if (pinchActive) log('Pinch end. Final zoom:', zoom.toFixed(2));
    setPinchActive(false);
  };

  const restoreScreenBrightness = useCallback(async () => {
    if (origBrightnessRef.current != null && ScreenBrightness) {
      try {
        await ScreenBrightness.setBrightness(origBrightnessRef.current);
        log('Screen brightness restored to', origBrightnessRef.current);
      } catch (e) {
        log('Screen brightness restore error:', e);
      }
      origBrightnessRef.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      restoreScreenBrightness();
    },
    [restoreScreenBrightness],
  );

  // Photo
  const takePhoto = async () => {
    if (!camera.current) return;

    if (timer > 0) {
      setCountdown(timer);
      const int = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(int);
            setCountdown(0);
          }
          return c - 1;
        });
      }, 1000);
      await new Promise(res => setTimeout(res, timer * 1000));
    }

    try {
      const flashParam =
        flashMode === 'flash' && device?.hasFlash ? 'on' : 'off';
      log('takePhoto ->', {
        flashParam,
        torch: flashMode === 'torch',
        zoom,
        ev,
      });

      const result = await camera.current.takePhoto({
        flash: flashParam,
        qualityPrioritization: 'quality',
      });
      setPhoto(result);
      setVideoFile(null);
      log('Photo taken:', result);
    } catch (e) {
      Alert.alert('Camera Error', e?.message || String(e));
      log('Error takePhoto:', e);
    }
  };

  // Video
  const startRecording = async () => {
    if (!camera.current) return;
    if (!hasMicPermission) {
      Alert.alert(
        'Microphone',
        'Please grant microphone permission for video.',
      );
      return;
    }
    try {
      log('startRecording...');
      setIsRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(
        () => setRecordSecs(s => s + 1),
        1000,
      );

      // Auto fallback for front camera low light
      if (mode === 'video' && cameraPosition === 'front' && autoLowLightFront) {
        if (videoFps > 24) {
          const newFps = clamp(24, videoFpsRange.min, videoFpsRange.max);
          setVideoFps(newFps);
          log('Auto low-light (front): 30fps -> 24fps to brighten video.');
        }
        // optional bias exposure positively if available
        try {
          if (camera.current?.setExposureCompensation) {
            await camera.current.setExposureCompensation(Math.max(ev, 0.7));
            log('Auto low-light: exposure compensation bumped.');
          }
        } catch {}
      }

      // Optional screen brightness boost for selfie light
      if (cameraPosition === 'front' && (selfieLight || lowLightPreset)) {
        const target = Math.max(selfieIntensity, 0.85);
        if (ScreenBrightness) {
          try {
            const cur = await ScreenBrightness.getBrightness();
            origBrightnessRef.current = cur;
            log('Current screen brightness:', cur, ' -> setting to', target);
            await ScreenBrightness.setBrightness(target);
          } catch (e) {
            log('ScreenBrightness error:', e);
          }
        } else {
          log('ScreenBrightness module missing, using edge light bars only.');
        }
      }

      camera.current.startRecording({
        onRecordingFinished: video => {
          log('Recording finished:', video);
          clearInterval(recordTimerRef.current);
          setIsRecording(false);
          setVideoFile(video);
          setPhoto(null);
          restoreScreenBrightness();
        },
        onRecordingError: error => {
          log('Recording error:', error);
          clearInterval(recordTimerRef.current);
          setIsRecording(false);
          restoreScreenBrightness();
          Alert.alert('Record Error', error?.message || String(error));
        },
        fileType: 'mp4',
      });
    } catch (e) {
      log('startRecording exception:', e);
      setIsRecording(false);
      restoreScreenBrightness();
    }
  };

  const stopRecording = async () => {
    if (!camera.current) return;
    try {
      log('stopRecording...');
      await camera.current.stopRecording();
    } catch (e) {
      log('stopRecording error:', e);
      restoreScreenBrightness();
    }
  };

  const saveCurrent = async () => {
    if (photo?.path) return savePhoto();
    if (videoFile?.path) return saveVideo();
  };

  const savePhoto = async () => {
    if (!photo?.path) return;
    setIsSaving(true);
    try {
      const signatureData = await fetch(
        'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
      ).then(res => res.json());
      log('Got ImageKit signature:', signatureData);

      const fileName = photo.path.split('/').pop() || `photo_${Date.now()}.jpg`;
      const wrappedPath = BlobUtil.wrap(photo.path.replace(/^file:\/\//, ''));

      const uploadData = [
        { name: 'file', filename: fileName, data: wrappedPath },
        { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
        { name: 'signature', data: signatureData.signature },
        { name: 'expire', data: String(signatureData.expire) },
        { name: 'token', data: signatureData.token },
        { name: 'fileName', data: fileName },
      ];

      const res = await BlobUtil.fetch(
        'POST',
        'https://upload.imagekit.io/api/v1/files/upload',
        {},
        uploadData,
      );
      const json = res.json();
      if (res.info().status >= 300)
        throw new Error(json?.message || 'ImageKit upload failed');

      const uploadUrl = json.url;
      log('ImageKit upload success (photo):', uploadUrl);

      const { data: inserted, error: supabaseError } = await supabase
        .from('images')
        .insert({
          user_id: userId,
          image_url: uploadUrl,
          storage_type: 'imagekit',
          created_at: new Date().toISOString(),
          file_name: fileName,
          favorite: false,
          type: 'photo',
          private: false,
        })
        .select('*')
        .single();

      if (supabaseError || !inserted) {
        Alert.alert('Save Error', supabaseError?.message || 'Insert failed');
        log('Supabase insert error:', supabaseError);
      } else {
        log('Supabase insert OK. Inserted:', inserted);
        try {
          log('Invoking push-new-image-v1 with image_id:', inserted.id);
          const tFn = Date.now();
          const { data: fnRes, error: fnErr } = await supabase.functions.invoke(
            'push-new-image-v1',
            { body: { image_id: inserted.id } },
          );
          const ms = Date.now() - tFn;
          if (fnErr) log('Edge function error:', fnErr, 'ms:', ms);
          else log('Edge function OK:', fnRes, 'ms:', ms);
        } catch (fnCatch) {
          log('Edge function invoke exception:', fnCatch);
        }

        Alert.alert('Saved!', 'Photo saved to gallery.');
        setPhoto(null);
      }
    } catch (e) {
      Alert.alert('Save Error', e?.message || String(e));
      log('Save error (photo):', e);
    } finally {
      setIsSaving(false);
    }
  };

  const saveVideo = async () => {
    if (!videoFile?.path) return;
    setIsSaving(true);
    try {
      const signatureData = await fetch(
        'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
      ).then(res => res.json());
      log('Got ImageKit signature:', signatureData);

      const baseName =
        videoFile.path.split('/').pop() || `video_${Date.now()}.mp4`;
      const fileName = baseName.endsWith('.mp4') ? baseName : `${baseName}.mp4`;
      const wrappedPath = BlobUtil.wrap(
        videoFile.path.replace(/^file:\/\//, ''),
      );

      const uploadData = [
        { name: 'file', filename: fileName, data: wrappedPath },
        { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
        { name: 'signature', data: signatureData.signature },
        { name: 'expire', data: String(signatureData.expire) },
        { name: 'token', data: signatureData.token },
        { name: 'fileName', data: fileName },
      ];

      const res = await BlobUtil.fetch(
        'POST',
        'https://upload.imagekit.io/api/v1/files/upload',
        {},
        uploadData,
      );
      const json = res.json();
      if (res.info().status >= 300)
        throw new Error(json?.message || 'ImageKit upload failed');

      const uploadUrl = json.url;
      log('ImageKit upload success (video):', uploadUrl);

      const { data: inserted, error: supabaseError } = await supabase
        .from('images')
        .insert({
          user_id: userId,
          image_url: uploadUrl,
          storage_type: 'imagekit',
          created_at: new Date().toISOString(),
          file_name: fileName,
          favorite: false,
          type: 'video',
          private: false,
        })
        .select('*')
        .single();

      if (supabaseError || !inserted) {
        Alert.alert('Save Error', supabaseError?.message || 'Insert failed');
        log('Supabase insert error:', supabaseError);
      } else {
        log('Supabase insert OK. Inserted:', inserted);
        try {
          log('Invoking push-new-image-v1 with image_id:', inserted.id);
          const tFn = Date.now();
          const { data: fnRes, error: fnErr } = await supabase.functions.invoke(
            'push-new-image-v1',
            { body: { image_id: inserted.id } },
          );
          const ms = Date.now() - tFn;
          if (fnErr) log('Edge function error:', fnErr, 'ms:', ms);
          else log('Edge function OK:', fnRes, 'ms:', ms);
        } catch (fnCatch) {
          log('Edge function invoke exception:', fnCatch);
        }

        Alert.alert('Saved!', 'Video saved to gallery.');
        setVideoFile(null);
      }
    } catch (e) {
      Alert.alert('Save Error', e?.message || String(e));
      log('Save error (video):', e);
    } finally {
      setIsSaving(false);
    }
  };

  const retake = () => {
    setPhoto(null);
    setVideoFile(null);
    log('Retake/reset');
  };

  // Render states
  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.loader} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={{ color: theme.colors.primary, marginTop: 10 }}>
          Checking camera permission...
        </Text>
      </SafeAreaView>
    );
  }
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.loader} edges={['top']}>
        <Icon name="camera-off" size={48} color="#aaa" />
        <Text
          style={{ color: theme.colors.primary, marginTop: 10, fontSize: 18 }}
        >
          Camera permission needed
        </Text>
        <Text style={{ color: '#888', marginTop: 8, textAlign: 'center' }}>
          Please enable camera permission in your phone settings and restart the
          app.
        </Text>
      </SafeAreaView>
    );
  }
  if (!device) {
    return (
      <SafeAreaView style={styles.loader} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text
          style={{
            color: theme.colors.primary,
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          {`No ${cameraPosition} camera detected.\nTry switching cameras or use a real device.`}
        </Text>
        <TouchableOpacity
          style={[styles.smallBtn, { borderColor: '#fff' }]}
          onPress={switchCamera}
        >
          <Text style={{ color: '#fff' }}>Switch Camera</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isCameraActive = isFocused && !!device && !photo && !videoFile;
  const torchValue = flashMode === 'torch' && device?.hasFlash ? 'on' : 'off';
  const camHeight = getCameraHeight();

  const minZ = typeof device.minZoom === 'number' ? device.minZoom : 1;
  const maxZ = typeof device.maxZoom === 'number' ? device.maxZoom : 4;

  const previewBoxHeight = camHeight;
  const isFull = aspectKey === 'full';

  // Edge light bars opacity (does not cover the preview)
  const edgeLightOpacity =
    cameraPosition === 'front' && isRecording && (selfieLight || lowLightPreset)
      ? selfieIntensity
      : 0;

  const currentFormat = mode === 'video' ? bestVideoFormat : bestPhotoFormat;
  const fpsToUse =
    mode === 'video'
      ? clamp(videoFps, videoFpsRange.min, videoFpsRange.max)
      : undefined;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: '#000' }}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <View style={{ flex: 1 }}>
        {!photo && !videoFile ? (
          <View style={styles.centerWrap}>
            <View
              style={[
                styles.previewContainer,
                { height: isFull ? '100%' : previewBoxHeight, width: '100%' },
              ]}
            >
              {/* Pinch responder overlay (captures only multi-touch) */}
              <View
                style={StyleSheet.absoluteFill}
                onStartShouldSetResponder={onStartShouldSetResponder}
                onMoveShouldSetResponder={onMoveShouldSetResponder}
                onResponderGrant={onResponderGrant}
                onResponderMove={onResponderMove}
                onResponderRelease={onResponderRelease}
                pointerEvents="box-none"
              />

              <Pressable
                style={{ flex: 1 }}
                onPress={handleTap}
                onLayout={e => {
                  const { width, height } = e.nativeEvent.layout;
                  setCamLayout({ w: width, h: height });
                  log('Camera layout set:', { width, height });
                }}
              >
                <Camera
                  ref={camera}
                  style={styles.camera}
                  device={device}
                  isActive={isCameraActive}
                  photo
                  video={mode === 'video'}
                  torch={torchValue}
                  enableZoomGesture // VisionCamera built-in pinch
                  zoom={zoom}
                  onInitialized={() => log('Camera initialized')}
                  onError={e => log('Camera onError:', e)}
                  format={currentFormat || undefined}
                  fps={fpsToUse}
                />

                {/* Edge light bars (do not cover preview) */}
                {edgeLightOpacity > 0 && (
                  <>
                    <View
                      style={[
                        styles.lightBarH,
                        { top: 0, opacity: edgeLightOpacity },
                      ]}
                    />
                    <View
                      style={[
                        styles.lightBarH,
                        { bottom: 0, opacity: edgeLightOpacity, height: 120 },
                      ]}
                    />
                    <View
                      style={[
                        styles.lightBarV,
                        { left: 0, opacity: edgeLightOpacity },
                      ]}
                    />
                    <View
                      style={[
                        styles.lightBarV,
                        { right: 0, opacity: edgeLightOpacity },
                      ]}
                    />
                  </>
                )}

                {/* Grid overlay */}
                {showGrid && (
                  <>
                    <View style={[styles.gridLine, { top: '33.33%' }]} />
                    <View style={[styles.gridLine, { top: '66.66%' }]} />
                    <View style={[styles.gridLineV, { left: '33.33%' }]} />
                    <View style={[styles.gridLineV, { left: '66.66%' }]} />
                  </>
                )}

                {/* Focus ring + temp EV near it */}
                {focusUI.visible && (
                  <>
                    <View
                      pointerEvents="none"
                      style={[
                        styles.focusRing,
                        { left: focusUI.x - 40, top: focusUI.y - 40 },
                      ]}
                    />
                    <View
                      style={[
                        styles.tempEVWrap,
                        {
                          left: clamp(focusUI.x + 50, 10, camLayout.w - 60),
                          top: clamp(focusUI.y - 80, 10, camLayout.h - 160),
                        },
                      ]}
                    >
                      <View style={styles.vSliderShell}>
                        <Slider
                          style={styles.vSlider}
                          value={ev}
                          minimumValue={-2}
                          maximumValue={2}
                          step={0.05}
                          minimumTrackTintColor="#FFD54F"
                          maximumTrackTintColor="rgba(255,255,255,0.3)"
                          thumbTintColor="#FFD54F"
                          onValueChange={v => applyExposure(v)}
                        />
                      </View>
                      <Text style={styles.vSliderLabel}>{`${ev.toFixed(
                        1,
                      )} EV`}</Text>
                    </View>
                  </>
                )}
              </Pressable>

              {/* LEFT: Exposure slider */}
              <View style={styles.leftSliderWrap}>
                <View style={styles.vSliderShell}>
                  <Slider
                    style={styles.vSlider}
                    value={ev}
                    minimumValue={-2}
                    maximumValue={2}
                    step={0.05}
                    minimumTrackTintColor="#FFD54F"
                    maximumTrackTintColor="rgba(255,255,255,0.3)"
                    thumbTintColor="#FFD54F"
                    onSlidingStart={() => log('EV slider start', { ev })}
                    onValueChange={v => applyExposure(v)}
                    onSlidingComplete={v => log('EV slider complete', { v })}
                  />
                </View>
                <Text style={styles.vSliderLabel}>{`${ev.toFixed(1)} EV`}</Text>
              </View>

              {/* RIGHT: Zoom slider */}
              <View style={styles.rightSliderWrap}>
                <View style={styles.vSliderShell}>
                  <Slider
                    style={styles.vSlider}
                    value={zoom}
                    minimumValue={minZ}
                    maximumValue={maxZ}
                    step={0.01}
                    minimumTrackTintColor="#fff"
                    maximumTrackTintColor="rgba(255,255,255,0.3)"
                    thumbTintColor="#fff"
                    onSlidingStart={() => log('Zoom slider start', { zoom })}
                    onValueChange={v => setZoom(v)}
                    onSlidingComplete={v => log('Zoom slider complete', { v })}
                  />
                </View>
                <Text style={styles.vSliderLabel}>{`${zoom.toFixed(2)}x`}</Text>
              </View>
            </View>
          </View>
        ) : photo ? (
          <Image
            source={{
              uri:
                Platform.OS === 'android' ? 'file://' + photo.path : photo.path,
            }}
            style={styles.camera}
            resizeMode="contain"
          />
        ) : (
          <Video
            source={{
              uri:
                Platform.OS === 'android'
                  ? 'file://' + videoFile.path
                  : videoFile.path,
            }}
            style={styles.camera}
            paused={false}
            repeat
            resizeMode="contain"
            onError={e => log('Preview video error:', e)}
          />
        )}

        {/* Top overlay */}
        <View
          pointerEvents="box-none"
          style={[styles.topOverlay, { paddingTop: insets.top + 6 }]}
        >
          {device?.hasFlash && !photo && !videoFile && (
            <TouchableOpacity
              onPress={cycleFlash}
              style={[
                styles.roundBtn,
                { left: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
              ]}
            >
              {flashMode === 'off' && (
                <Icon name="flash-off" size={28} color="#fff" />
              )}
              {flashMode === 'flash' && (
                <Icon name="flash" size={28} color="#fff" />
              )}
              {flashMode === 'torch' && (
                <Icon name="flashlight" size={28} color="#fff" />
              )}
            </TouchableOpacity>
          )}

          {!photo && !videoFile && (
            <View style={styles.aspectWrap}>
              {ASPECTS.map(a => (
                <TouchableOpacity
                  key={a.key}
                  onPress={() => {
                    setAspectKey(a.key);
                    log('Aspect set:', a.key, a.ratio);
                  }}
                  style={[
                    styles.aspectBtn,
                    aspectKey === a.key && {
                      backgroundColor: 'rgba(255,255,255,0.15)',
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: '#fff',
                      fontWeight: aspectKey === a.key ? 'bold' : 'normal',
                      fontSize: 12,
                    }}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Right control panel */}
        {!photo && !videoFile && (
          <View style={styles.rightPanel}>
            {/* Grid toggle */}
            <TouchableOpacity
              style={[styles.toggleBtn, showGrid && styles.toggleBtnOn]}
              onPress={() => setShowGrid(v => !v)}
            >
              <Icon name="grid-outline" size={18} color="#fff" />
              <Text style={styles.toggleTxt}>
                {showGrid ? 'Grid On' : 'Grid Off'}
              </Text>
            </TouchableOpacity>

            {/* Timer */}
            <View style={styles.timerRow}>
              {TIMERS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.timerBtn, timer === t && styles.timerBtnOn]}
                  onPress={() => {
                    setTimer(t);
                    log('Timer set:', t);
                  }}
                >
                  <Text style={styles.timerTxt}>
                    {t === 0 ? 'OFF' : `${t}s`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Video FPS + Auto low-light */}
            {mode === 'video' && (
              <>
                <View style={[styles.timerRow, { marginTop: 6 }]}>
                  {FPS_CHOICES.map(f => {
                    const supported =
                      f >= videoFpsRange.min && f <= videoFpsRange.max;
                    return (
                      <TouchableOpacity
                        key={f}
                        disabled={!supported}
                        onPress={() => {
                          const clamped = clamp(
                            f,
                            videoFpsRange.min,
                            videoFpsRange.max,
                          );
                          setVideoFps(clamped);
                          log(
                            'Video FPS set:',
                            clamped,
                            'range:',
                            videoFpsRange,
                          );
                        }}
                        style={[
                          styles.timerBtn,
                          videoFps === f && styles.timerBtnOn,
                          !supported && { opacity: 0.3 },
                        ]}
                      >
                        <Text style={styles.timerTxt}>{f}fps</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Auto low-light (front) */}
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    autoLowLightFront && styles.toggleBtnOn,
                    { marginTop: 6 },
                  ]}
                  onPress={() => {
                    const next = !autoLowLightFront;
                    setAutoLowLightFront(next);
                    log('Auto low-light (front) ->', next);
                  }}
                >
                  <Icon name="sparkles-outline" size={18} color="#fff" />
                  <Text style={styles.toggleTxt}>
                    {autoLowLightFront
                      ? 'Auto Low-Light On'
                      : 'Auto Low-Light Off'}
                  </Text>
                </TouchableOpacity>

                {/* Selfie light controls */}
                {cameraPosition === 'front' && (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.toggleBtn,
                        (selfieLight || lowLightPreset) && styles.toggleBtnOn,
                        { marginTop: 6 },
                      ]}
                      onPress={() => {
                        const next = !selfieLight;
                        setSelfieLight(next);
                        if (!next && !lowLightPreset) restoreScreenBrightness();
                        log('Selfie Light ->', next);
                      }}
                    >
                      <Icon name="bulb-outline" size={18} color="#fff" />
                      <Text style={styles.toggleTxt}>
                        {selfieLight ? 'Selfie Light On' : 'Selfie Light Off'}
                      </Text>
                    </TouchableOpacity>

                    <View style={[styles.vSliderShell, { marginTop: 6 }]}>
                      <Slider
                        style={styles.vSlider}
                        value={selfieIntensity}
                        minimumValue={0}
                        maximumValue={1}
                        step={0.05}
                        minimumTrackTintColor="#fff"
                        maximumTrackTintColor="rgba(255,255,255,0.3)"
                        thumbTintColor="#fff"
                        onValueChange={v => {
                          setSelfieIntensity(v);
                          log('Selfie intensity:', v);
                        }}
                      />
                    </View>
                    <Text style={styles.vSliderLabel}>{`Fill ${Math.round(
                      selfieIntensity * 100,
                    )}%`}</Text>

                    <TouchableOpacity
                      style={[
                        styles.toggleBtn,
                        lowLightPreset && styles.toggleBtnOn,
                        { marginTop: 6 },
                      ]}
                      onPress={() => {
                        const next = !lowLightPreset;
                        setLowLightPreset(next);
                        if (next) {
                          const targetFps = clamp(
                            24,
                            videoFpsRange.min,
                            videoFpsRange.max,
                          );
                          setVideoFps(targetFps);
                          setSelfieLight(true);
                          setSelfieIntensity(v => Math.max(v, 0.85));
                          log(
                            'Low-Light preset ON -> fps',
                            targetFps,
                            'intensity >= 0.85',
                          );
                        } else {
                          log('Low-Light preset OFF');
                        }
                      }}
                    >
                      <Icon name="moon-outline" size={18} color="#fff" />
                      <Text style={styles.toggleTxt}>
                        {lowLightPreset ? 'Low-Light On' : 'Low-Light Off'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>
        )}

        {/* Bottom overlay */}
        <View
          pointerEvents="box-none"
          style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 12 }]}
        >
          {/* Mode switch above shutter */}
          {!photo && !videoFile && (
            <View style={styles.modeRow}>
              <TouchableOpacity
                onPress={() => {
                  setMode('photo');
                  log('Mode -> photo');
                }}
                style={[
                  styles.modeBtn,
                  mode === 'photo' && styles.modeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeTxt,
                    mode === 'photo' && styles.modeTxtActive,
                  ]}
                >
                  PHOTO
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setMode('video');
                  log('Mode -> video');
                }}
                style={[
                  styles.modeBtn,
                  mode === 'video' && styles.modeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeTxt,
                    mode === 'video' && styles.modeTxtActive,
                  ]}
                >
                  VIDEO
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {!photo && !videoFile ? (
            <>
              {/* Shutter row with camera switch next to it (bottom-right) */}
              <View style={styles.shutterRow}>
                <View style={{ width: 70 }} />
                {mode === 'photo' ? (
                  <TouchableOpacity
                    style={[
                      styles.shutterBtn,
                      { backgroundColor: shutterColor },
                    ]}
                    onPress={takePhoto}
                    activeOpacity={0.9}
                  >
                    <Icon name="ellipse" size={60} color="#fff" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.shutterBtn,
                      { backgroundColor: isRecording ? '#D32F2F' : '#FF3D00' },
                    ]}
                    onPress={isRecording ? stopRecording : startRecording}
                    activeOpacity={0.9}
                  >
                    <Icon
                      name={isRecording ? 'square' : 'radio-button-on'}
                      size={60}
                      color="#fff"
                    />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={switchCamera}
                  style={styles.switchNearShutter}
                  activeOpacity={0.9}
                >
                  <Icon name="camera-reverse" size={26} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Countdown bubble / Recording time */}
              {mode === 'photo' && countdown > 0 && (
                <View style={styles.countdownBubble}>
                  <Text
                    style={{ color: '#fff', fontSize: 24, fontWeight: 'bold' }}
                  >
                    {countdown}
                  </Text>
                </View>
              )}
              {mode === 'video' && isRecording && (
                <View style={styles.countdownBubble}>
                  <Text
                    style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}
                  >
                    ● {Math.floor(recordSecs / 60)}:
                    {String(recordSecs % 60).padStart(2, '0')}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#fff' }]}
                onPress={retake}
              >
                <Icon name="refresh" size={24} color={shutterColor} />
                <Text style={{ color: shutterColor, marginTop: 4 }}>
                  Retake
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: shutterColor }]}
                onPress={saveCurrent}
                disabled={isSaving}
              >
                <Icon name="checkmark" size={24} color="#fff" />
                <Text style={{ color: '#fff', marginTop: 4 }}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingHorizontal: 16,
  },
  camera: { width: '100%', height: '100%' },

  // Center preview vertically
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewContainer: { width: '100%', backgroundColor: '#000' },

  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roundBtn: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  aspectWrap: {
    position: 'absolute',
    top: 8,
    left: '25%',
    right: '25%',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 4,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    gap: 4,
  },
  aspectBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },

  rightPanel: {
    position: 'absolute',
    right: 8,
    top: 90,
    padding: 6,
    alignItems: 'center',
    gap: 8,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 6,
  },
  toggleBtnOn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  toggleTxt: { color: '#fff', fontSize: 12 },

  timerRow: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    padding: 4,
  },
  timerBtn: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10 },
  timerBtnOn: { backgroundColor: 'rgba(255,255,255,0.18)' },
  timerTxt: { color: '#fff', fontSize: 12 },

  bottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },

  modeRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 16,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 6,
    marginBottom: 6,
  },
  modeBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
  modeBtnActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  modeTxt: { color: '#fff', fontSize: 12 },
  modeTxtActive: { fontWeight: 'bold', color: '#fff' },

  // Shutter row with camera switch next to it
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '80%',
  },
  shutterBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    marginVertical: 6,
  },
  switchNearShutter: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '72%',
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    minWidth: 110,
    elevation: 2,
  },
  smallBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  // Grid lines
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },

  // Focus ring
  focusRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FFD54F',
    backgroundColor: 'transparent',
  },

  // Edge light bars (emit light without covering preview)
  lightBarH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: '#fff',
  },
  lightBarV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 24,
    backgroundColor: '#fff',
  },

  // Vertical sliders (rotated)
  leftSliderWrap: {
    position: 'absolute',
    left: 6,
    top: 90,
    bottom: 140,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightSliderWrap: {
    position: 'absolute',
    right: 6,
    top: 90,
    bottom: 140,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vSliderShell: {
    width: 200,
    height: 44,
    transform: [{ rotate: '-90deg' }],
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  vSlider: { width: '100%', height: 44 },
  vSliderLabel: {
    color: '#fff',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },

  // Temp EV near focus ring
  tempEVWrap: { position: 'absolute', width: 44, alignItems: 'center' },

  countdownBubble: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
  },
});

export default CameraScreen;

// import React, { useState, useEffect, useRef, useCallback } from 'react';
// import {
//   View,
//   Text,
//   TouchableOpacity,
//   StyleSheet,
//   ActivityIndicator,
//   Alert,
//   Platform,
//   Image,
//   Pressable,
//   Dimensions,
// } from 'react-native';
// import {
//   SafeAreaView,
//   useSafeAreaInsets,
// } from 'react-native-safe-area-context';
// import { useIsFocused, useFocusEffect } from '@react-navigation/native';
// import {
//   Camera,
//   useCameraDevice,
//   useCameraDevices,
// } from 'react-native-vision-camera';
// import Slider from '@react-native-community/slider';
// import Video from 'react-native-video';
// import { useTheme } from '../theme/ThemeContext';
// import { supabase } from '../services/supabase';
// import BlobUtil from 'react-native-blob-util';
// import Icon from 'react-native-vector-icons/Ionicons';
// import { COLORS } from '../theme/colors';

// const log = (...a) => console.log('[Camera]', ...a);
// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// const ASPECTS = [
//   { key: 'full', label: 'FULL', ratio: 0 }, // fill height
//   { key: '1:1', label: '1:1', ratio: 1 },
//   { key: '4:3', label: '4:3', ratio: 4 / 3 },
//   { key: '16:9', label: '16:9', ratio: 16 / 9 },
// ];

// const TIMERS = [0, 3, 10];

// const CameraScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const insets = useSafeAreaInsets();
//   const isFocused = useIsFocused();

//   const camera = useRef(null);
//   const [hasPermission, setHasPermission] = useState(null);
//   const [hasMicPermission, setHasMicPermission] = useState(null);

//   // Photo/Video capture states
//   const [photo, setPhoto] = useState(null);
//   const [videoFile, setVideoFile] = useState(null);
//   const [isSaving, setIsSaving] = useState(false);

//   const [userId, setUserId] = useState('');
//   const [profile, setProfile] = useState('me'); // 'me' | 'her'
//   const [cameraPosition, setCameraPosition] = useState('back'); // 'back' | 'front'
//   const [flashMode, setFlashMode] = useState('off'); // 'off' | 'flash' | 'torch'

//   // Mode: photo or video
//   const [mode, setMode] = useState('photo'); // 'photo' | 'video'
//   const [isRecording, setIsRecording] = useState(false);
//   const recordTimerRef = useRef(null);
//   const [recordSecs, setRecordSecs] = useState(0);

//   // Pro controls
//   const [zoom, setZoom] = useState(1);
//   const [aspectKey, setAspectKey] = useState('full');
//   const [showGrid, setShowGrid] = useState(false);
//   const [ev, setEv] = useState(0); // exposure compensation
//   const [timer, setTimer] = useState(0);
//   const [countdown, setCountdown] = useState(0);

//   // Tap to focus UI
//   const [focusUI, setFocusUI] = useState({ visible: false, x: 0, y: 0 });
//   const lastTapRef = useRef(0);
//   const [camLayout, setCamLayout] = useState({
//     w: SCREEN_WIDTH,
//     h: SCREEN_HEIGHT,
//   });

//   // Resolve device correctly by position
//   const device = useCameraDevice(cameraPosition);
//   const devicesList = useCameraDevices(); // for logs/fallback only

//   // Hide Tab Bar only while this screen is focused
//   useFocusEffect(
//     useCallback(() => {
//       const parent = navigation.getParent?.();
//       parent?.setOptions({ tabBarStyle: { display: 'none' } });
//       return () => parent?.setOptions({ tabBarStyle: undefined });
//     }, [navigation]),
//   );

//   // Shutter color by profile
//   const shutterColor =
//     profile === 'me' ? COLORS.blue.primary : COLORS.pink.primary;

//   // Log devices + auto-fallback if one side missing
//   useEffect(() => {
//     const list = Array.isArray(devicesList)
//       ? devicesList
//       : devicesList
//       ? Object.values(devicesList)
//       : [];
//     log(
//       'Devices:',
//       list.map(d => ({
//         pos: d.position,
//         id: d.id,
//         name: d.name,
//         hasFlash: d.hasFlash,
//         minZoom: d.minZoom,
//         maxZoom: d.maxZoom,
//         neutralZoom: d.neutralZoom,
//       })),
//     );
//     if (!device && list.length) {
//       const hasBack = list.some(d => d.position === 'back');
//       const hasFront = list.some(d => d.position === 'front');
//       if (cameraPosition === 'back' && !hasBack && hasFront) {
//         log('Auto-switch → front (no back cam)');
//         setCameraPosition('front');
//       } else if (cameraPosition === 'front' && !hasFront && hasBack) {
//         log('Auto-switch → back (no front cam)');
//         setCameraPosition('back');
//       }
//     } else if (device) {
//       log('Using device:', {
//         pos: device.position,
//         id: device.id,
//         name: device.name,
//         hasFlash: device.hasFlash,
//         minZoom: device.minZoom,
//         maxZoom: device.maxZoom,
//         neutralZoom: device.neutralZoom,
//       });
//       const startZoom =
//         typeof device.neutralZoom === 'number'
//           ? device.neutralZoom
//           : typeof device.minZoom === 'number'
//           ? device.minZoom
//           : 1;
//       setZoom(startZoom);
//     }
//   }, [devicesList, device, cameraPosition]);

//   // Auth + selected profile
//   useEffect(() => {
//     (async () => {
//       const {
//         data: { user },
//         error,
//       } = await supabase.auth.getUser();
//       if (error) log('getUser error:', error);
//       setUserId(user?.id || '');
//       log('userId:', user?.id);

//       if (user?.id) {
//         const { data: prof, error: pErr } = await supabase
//           .from('profiles')
//           .select('current_profile')
//           .eq('id', user.id)
//           .single();
//         if (pErr) log('profiles fetch error:', pErr);
//         setProfile(prof?.current_profile || 'me');
//         log('Loaded profile:', prof?.current_profile);
//       }
//     })();
//   }, []);

//   // Permissions (camera + microphone)
//   useEffect(() => {
//     (async () => {
//       try {
//         const camStatus = await Camera.getCameraPermissionStatus();
//         log('Initial camera perm:', camStatus);
//         if (camStatus !== 'authorized' && camStatus !== 'granted') {
//           const req = await Camera.requestCameraPermission();
//           setHasPermission(req === 'authorized' || req === 'granted');
//           log('Camera permission requested ->', req);
//         } else {
//           setHasPermission(true);
//         }

//         const micStatus = await Camera.getMicrophonePermissionStatus();
//         log('Initial mic perm:', micStatus);
//         if (micStatus !== 'authorized' && micStatus !== 'granted') {
//           const reqM = await Camera.requestMicrophonePermission();
//           setHasMicPermission(reqM === 'authorized' || reqM === 'granted');
//           log('Microphone permission requested ->', reqM);
//         } else {
//           setHasMicPermission(true);
//         }
//       } catch (e) {
//         setHasPermission(false);
//         setHasMicPermission(false);
//         log('Permission error:', e);
//       }
//     })();
//   }, []);

//   const cycleFlash = () => {
//     setFlashMode(prev => {
//       const next =
//         prev === 'off' ? 'flash' : prev === 'flash' ? 'torch' : 'off';
//       log('Flash mode:', next);
//       return next;
//     });
//   };

//   const switchCamera = () => {
//     setCameraPosition(prev => {
//       const next = prev === 'back' ? 'front' : 'back';
//       log('Switching camera to:', next);
//       return next;
//     });
//   };

//   // Zoom helpers
//   const quickZoomToggle = () => {
//     const neutral =
//       typeof device?.neutralZoom === 'number' ? device.neutralZoom : 1;
//     const target = zoom < neutral * 1.9 ? neutral * 2 : neutral;
//     const minZ = typeof device?.minZoom === 'number' ? device.minZoom : 1;
//     const maxZ = typeof device?.maxZoom === 'number' ? device.maxZoom : 4;
//     setZoom(clamp(target, minZ, maxZ));
//     log('Quick zoom toggle:', { neutral, target });
//   };

//   // Exposure control helper
//   const applyExposure = async val => {
//     setEv(val);
//     try {
//       if (camera.current?.setExposure) {
//         await camera.current.setExposure(val);
//         log('setExposure applied:', val);
//       } else if (camera.current?.setExposureCompensation) {
//         await camera.current.setExposureCompensation(val);
//         log('setExposureCompensation applied:', val);
//       } else {
//         log(
//           'Exposure not supported on this device/SDK; keeping EV in UI only.',
//         );
//       }
//     } catch (e) {
//       log('Exposure apply error:', e);
//     }
//   };

//   // Aspect sizing: centered vertically
//   const getCameraHeight = () => {
//     const aspect = ASPECTS.find(a => a.key === aspectKey);
//     if (!aspect || aspect.ratio <= 0) return SCREEN_HEIGHT; // full height
//     return SCREEN_WIDTH / aspect.ratio;
//   };

//   // Tap to focus/expose with double-tap quick zoom
//   const handleTap = async evt => {
//     const now = Date.now();
//     const doubleTap = now - (lastTapRef.current || 0) < 300;
//     lastTapRef.current = now;

//     const { locationX, locationY } = evt.nativeEvent;
//     if (!camLayout.w || !camLayout.h) return;

//     const xNorm = clamp(locationX / camLayout.w, 0, 1);
//     const yNorm = clamp(locationY / camLayout.h, 0, 1);

//     if (doubleTap) {
//       quickZoomToggle();
//       return;
//     }

//     // Show focus ring + temp EV slider next to it
//     setFocusUI({ visible: true, x: locationX, y: locationY });
//     setTimeout(() => setFocusUI(f => ({ ...f, visible: false })), 1800);

//     try {
//       if (camera.current?.focus) {
//         await camera.current.focus({ x: xNorm, y: yNorm });
//         log('Focus at:', { xNorm, yNorm });
//       } else {
//         log('focus() not supported in this build.');
//       }
//       if (camera.current?.setExposurePoint) {
//         await camera.current.setExposurePoint({ x: xNorm, y: yNorm });
//         log('Exposure point at:', { xNorm, yNorm });
//       } else {
//         log('setExposurePoint() not supported in this build.');
//       }
//     } catch (e) {
//       log('Tap focus/expose error:', e);
//     }
//   };

//   // Capture: Photo
//   const takePhoto = async () => {
//     if (!camera.current) {
//       log('No camera ref');
//       return;
//     }

//     // Timer
//     if (timer > 0) {
//       setCountdown(timer);
//       const int = setInterval(() => {
//         setCountdown(c => {
//           if (c <= 1) {
//             clearInterval(int);
//             setCountdown(0);
//           }
//           return c - 1;
//         });
//       }, 1000);
//       await new Promise(res => setTimeout(res, timer * 1000));
//     }

//     try {
//       const flashParam =
//         flashMode === 'flash' && device?.hasFlash ? 'on' : 'off';
//       log('takePhoto ->', {
//         flashParam,
//         torch: flashMode === 'torch',
//         zoom,
//         ev,
//       });

//       const result = await camera.current.takePhoto({
//         flash: flashParam,
//         qualityPrioritization: 'quality',
//       });
//       setPhoto(result);
//       setVideoFile(null);
//       log('Photo taken:', result);
//     } catch (e) {
//       Alert.alert('Camera Error', e?.message || String(e));
//       log('Error takePhoto:', e);
//     }
//   };

//   // Capture: Video
//   const startRecording = async () => {
//     if (!camera.current) return;
//     if (!hasMicPermission) {
//       Alert.alert(
//         'Microphone',
//         'Please grant microphone permission for video.',
//       );
//       return;
//     }
//     try {
//       log('startRecording...');
//       setIsRecording(true);
//       setRecordSecs(0);
//       recordTimerRef.current = setInterval(
//         () => setRecordSecs(s => s + 1),
//         1000,
//       );

//       camera.current.startRecording({
//         onRecordingFinished: video => {
//           log('Recording finished:', video);
//           clearInterval(recordTimerRef.current);
//           setIsRecording(false);
//           setVideoFile(video); // { path }
//           setPhoto(null);
//         },
//         onRecordingError: error => {
//           log('Recording error:', error);
//           clearInterval(recordTimerRef.current);
//           setIsRecording(false);
//           Alert.alert('Record Error', error?.message || String(error));
//         },
//         fileType: 'mp4',
//       });
//     } catch (e) {
//       log('startRecording exception:', e);
//       setIsRecording(false);
//     }
//   };

//   const stopRecording = async () => {
//     if (!camera.current) return;
//     try {
//       log('stopRecording...');
//       await camera.current.stopRecording();
//     } catch (e) {
//       log('stopRecording error:', e);
//     }
//   };

//   const saveCurrent = async () => {
//     if (photo?.path) return savePhoto();
//     if (videoFile?.path) return saveVideo();
//   };

//   const savePhoto = async () => {
//     if (!photo?.path) {
//       log('No photo to save');
//       return;
//     }
//     setIsSaving(true);
//     try {
//       const signatureData = await fetch(
//         'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//       ).then(res => res.json());
//       log('Got ImageKit signature:', signatureData);

//       const fileName = photo.path.split('/').pop() || `photo_${Date.now()}.jpg`;
//       const wrappedPath = BlobUtil.wrap(
//         photo.path.startsWith('file://')
//           ? photo.path.replace('file://', '')
//           : photo.path,
//       );

//       const uploadData = [
//         { name: 'file', filename: fileName, data: wrappedPath },
//         { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
//         { name: 'signature', data: signatureData.signature },
//         { name: 'expire', data: String(signatureData.expire) },
//         { name: 'token', data: signatureData.token },
//         { name: 'fileName', data: fileName },
//       ];

//       const res = await BlobUtil.fetch(
//         'POST',
//         'https://upload.imagekit.io/api/v1/files/upload',
//         {},
//         uploadData,
//       );
//       const json = res.json();
//       if (res.info().status >= 300)
//         throw new Error(json?.message || 'ImageKit upload failed');

//       const uploadUrl = json.url;
//       log('ImageKit upload success (photo):', uploadUrl);

//       const { data: inserted, error: supabaseError } = await supabase
//         .from('images')
//         .insert({
//           user_id: userId,
//           image_url: uploadUrl,
//           storage_type: 'imagekit',
//           created_at: new Date().toISOString(),
//           file_name: fileName,
//           favorite: false,
//           type: 'photo',
//           private: false,
//         })
//         .select('*')
//         .single();

//       if (supabaseError || !inserted) {
//         Alert.alert('Save Error', supabaseError?.message || 'Insert failed');
//         log('Supabase insert error:', supabaseError);
//       } else {
//         log('Supabase insert OK. Inserted:', inserted);
//         try {
//           log('Invoking push-new-image-v1 with image_id:', inserted.id);
//           const tFn = Date.now();
//           const { data: fnRes, error: fnErr } = await supabase.functions.invoke(
//             'push-new-image-v1',
//             { body: { image_id: inserted.id } },
//           );
//           const ms = Date.now() - tFn;
//           if (fnErr) log('Edge function error:', fnErr, 'ms:', ms);
//           else log('Edge function OK:', fnRes, 'ms:', ms);
//         } catch (fnCatch) {
//           log('Edge function invoke exception:', fnCatch);
//         }

//         Alert.alert('Saved!', 'Photo saved to gallery.');
//         setPhoto(null);
//       }
//     } catch (e) {
//       Alert.alert('Save Error', e?.message || String(e));
//       log('Save error (photo):', e);
//     } finally {
//       setIsSaving(false);
//     }
//   };

//   const saveVideo = async () => {
//     if (!videoFile?.path) {
//       log('No video to save');
//       return;
//     }
//     setIsSaving(true);
//     try {
//       const signatureData = await fetch(
//         'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//       ).then(res => res.json());
//       log('Got ImageKit signature:', signatureData);

//       const baseName =
//         videoFile.path.split('/').pop() || `video_${Date.now()}.mp4`;
//       const fileName = baseName.endsWith('.mp4') ? baseName : `${baseName}.mp4`;
//       const wrappedPath = BlobUtil.wrap(
//         videoFile.path.startsWith('file://')
//           ? videoFile.path.replace('file://', '')
//           : videoFile.path,
//       );

//       const uploadData = [
//         { name: 'file', filename: fileName, data: wrappedPath },
//         { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
//         { name: 'signature', data: signatureData.signature },
//         { name: 'expire', data: String(signatureData.expire) },
//         { name: 'token', data: signatureData.token },
//         { name: 'fileName', data: fileName },
//       ];

//       const res = await BlobUtil.fetch(
//         'POST',
//         'https://upload.imagekit.io/api/v1/files/upload',
//         {},
//         uploadData,
//       );
//       const json = res.json();
//       if (res.info().status >= 300)
//         throw new Error(json?.message || 'ImageKit upload failed');

//       const uploadUrl = json.url;
//       log('ImageKit upload success (video):', uploadUrl);

//       const { data: inserted, error: supabaseError } = await supabase
//         .from('images')
//         .insert({
//           user_id: userId,
//           image_url: uploadUrl,
//           storage_type: 'imagekit',
//           created_at: new Date().toISOString(),
//           file_name: fileName,
//           favorite: false,
//           type: 'video',
//           private: false,
//         })
//         .select('*')
//         .single();

//       if (supabaseError || !inserted) {
//         Alert.alert('Save Error', supabaseError?.message || 'Insert failed');
//         log('Supabase insert error:', supabaseError);
//       } else {
//         log('Supabase insert OK. Inserted:', inserted);
//         try {
//           log('Invoking push-new-image-v1 with image_id:', inserted.id);
//           const tFn = Date.now();
//           const { data: fnRes, error: fnErr } = await supabase.functions.invoke(
//             'push-new-image-v1',
//             { body: { image_id: inserted.id } },
//           );
//           const ms = Date.now() - tFn;
//           if (fnErr) log('Edge function error:', fnErr, 'ms:', ms);
//           else log('Edge function OK:', fnRes, 'ms:', ms);
//         } catch (fnCatch) {
//           log('Edge function invoke exception:', fnCatch);
//         }

//         Alert.alert('Saved!', 'Video saved to gallery.');
//         setVideoFile(null);
//       }
//     } catch (e) {
//       Alert.alert('Save Error', e?.message || String(e));
//       log('Save error (video):', e);
//     } finally {
//       setIsSaving(false);
//     }
//   };

//   const retake = () => {
//     setPhoto(null);
//     setVideoFile(null);
//     log('Retake/reset');
//   };

//   // Render states
//   if (hasPermission === null) {
//     return (
//       <SafeAreaView style={styles.loader} edges={['top']}>
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//         <Text style={{ color: theme.colors.primary, marginTop: 10 }}>
//           Checking camera permission...
//         </Text>
//       </SafeAreaView>
//     );
//   }
//   if (!hasPermission) {
//     return (
//       <SafeAreaView style={styles.loader} edges={['top']}>
//         <Icon name="camera-off" size={48} color="#aaa" />
//         <Text
//           style={{ color: theme.colors.primary, marginTop: 10, fontSize: 18 }}
//         >
//           Camera permission needed
//         </Text>
//         <Text style={{ color: '#888', marginTop: 8, textAlign: 'center' }}>
//           Please enable camera permission in your phone settings and restart the
//           app.
//         </Text>
//       </SafeAreaView>
//     );
//   }
//   if (!device) {
//     return (
//       <SafeAreaView style={styles.loader} edges={['top']}>
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//         <Text
//           style={{
//             color: theme.colors.primary,
//             marginTop: 10,
//             textAlign: 'center',
//           }}
//         >
//           {`No ${cameraPosition} camera detected.\nTry switching cameras or use a real device.`}
//         </Text>
//         <TouchableOpacity
//           style={[styles.smallBtn, { borderColor: '#fff' }]}
//           onPress={switchCamera}
//         >
//           <Text style={{ color: '#fff' }}>Switch Camera</Text>
//         </TouchableOpacity>
//       </SafeAreaView>
//     );
//   }

//   const isCameraActive = isFocused && !!device && !photo && !videoFile;
//   const torchValue = flashMode === 'torch' && device?.hasFlash ? 'on' : 'off';
//   const camHeight = getCameraHeight();

//   const minZ = typeof device.minZoom === 'number' ? device.minZoom : 1;
//   const maxZ = typeof device.maxZoom === 'number' ? device.maxZoom : 4;

//   // Centered preview box: sits in middle for fixed aspects
//   const previewBoxHeight = camHeight;
//   const isFull = aspectKey === 'full';

//   return (
//     <SafeAreaView
//       style={{ flex: 1, backgroundColor: '#000' }}
//       edges={['top', 'left', 'right', 'bottom']}
//     >
//       <View style={{ flex: 1 }}>
//         {!photo && !videoFile ? (
//           <View style={styles.centerWrap}>
//             <View
//               style={[
//                 styles.previewContainer,
//                 { height: isFull ? '100%' : previewBoxHeight, width: '100%' },
//               ]}
//             >
//               <Pressable
//                 style={{ flex: 1 }}
//                 onPress={handleTap}
//                 onLayout={e => {
//                   const { width, height } = e.nativeEvent.layout;
//                   setCamLayout({ w: width, h: height });
//                   log('Camera layout set:', { width, height });
//                 }}
//               >
//                 <Camera
//                   ref={camera}
//                   style={styles.camera}
//                   device={device}
//                   isActive={isCameraActive}
//                   photo
//                   video={mode === 'video'}
//                   torch={torchValue}
//                   enableZoomGesture
//                   zoom={zoom}
//                   onInitialized={() => log('Camera initialized')}
//                   onError={e => log('Camera onError:', e)}
//                 />

//                 {/* Grid overlay (3x3) */}
//                 {showGrid && (
//                   <>
//                     <View style={[styles.gridLine, { top: '33.33%' }]} />
//                     <View style={[styles.gridLine, { top: '66.66%' }]} />
//                     <View style={[styles.gridLineV, { left: '33.33%' }]} />
//                     <View style={[styles.gridLineV, { left: '66.66%' }]} />
//                   </>
//                 )}

//                 {/* Focus ring + temp EV near it */}
//                 {focusUI.visible && (
//                   <>
//                     <View
//                       pointerEvents="none"
//                       style={[
//                         styles.focusRing,
//                         { left: focusUI.x - 40, top: focusUI.y - 40 },
//                       ]}
//                     />
//                     <View
//                       style={[
//                         styles.tempEVWrap,
//                         {
//                           left: clamp(focusUI.x + 50, 10, camLayout.w - 60),
//                           top: clamp(focusUI.y - 80, 10, camLayout.h - 160),
//                         },
//                       ]}
//                     >
//                       <View style={styles.vSliderShell}>
//                         <Slider
//                           style={styles.vSlider}
//                           value={ev}
//                           minimumValue={-2}
//                           maximumValue={2}
//                           step={0.05}
//                           minimumTrackTintColor="#FFD54F"
//                           maximumTrackTintColor="rgba(255,255,255,0.3)"
//                           thumbTintColor="#FFD54F"
//                           onValueChange={v => applyExposure(v)}
//                         />
//                       </View>
//                       <Text style={styles.vSliderLabel}>{`${ev.toFixed(
//                         1,
//                       )} EV`}</Text>
//                     </View>
//                   </>
//                 )}
//               </Pressable>

//               {/* LEFT: Exposure slider */}
//               <View style={styles.leftSliderWrap}>
//                 <View style={styles.vSliderShell}>
//                   <Slider
//                     style={styles.vSlider}
//                     value={ev}
//                     minimumValue={-2}
//                     maximumValue={2}
//                     step={0.05}
//                     minimumTrackTintColor="#FFD54F"
//                     maximumTrackTintColor="rgba(255,255,255,0.3)"
//                     thumbTintColor="#FFD54F"
//                     onSlidingStart={() => log('EV slider start', { ev })}
//                     onValueChange={v => applyExposure(v)}
//                     onSlidingComplete={v => log('EV slider complete', { v })}
//                   />
//                 </View>
//                 <Text style={styles.vSliderLabel}>{`${ev.toFixed(1)} EV`}</Text>
//               </View>

//               {/* RIGHT: Zoom slider */}
//               <View style={styles.rightSliderWrap}>
//                 <View style={styles.vSliderShell}>
//                   <Slider
//                     style={styles.vSlider}
//                     value={zoom}
//                     minimumValue={minZ}
//                     maximumValue={maxZ}
//                     step={0.01}
//                     minimumTrackTintColor="#fff"
//                     maximumTrackTintColor="rgba(255,255,255,0.3)"
//                     thumbTintColor="#fff"
//                     onSlidingStart={() => log('Zoom slider start', { zoom })}
//                     onValueChange={v => setZoom(v)}
//                     onSlidingComplete={v => log('Zoom slider complete', { v })}
//                   />
//                 </View>
//                 <Text style={styles.vSliderLabel}>{`${zoom.toFixed(2)}x`}</Text>
//               </View>
//             </View>
//           </View>
//         ) : photo ? (
//           <Image
//             source={{
//               uri:
//                 Platform.OS === 'android' ? 'file://' + photo.path : photo.path,
//             }}
//             style={styles.camera}
//             resizeMode="contain"
//           />
//         ) : (
//           <Video
//             source={{
//               uri:
//                 Platform.OS === 'android'
//                   ? 'file://' + videoFile.path
//                   : videoFile.path,
//             }}
//             style={styles.camera}
//             paused={false}
//             repeat
//             resizeMode="contain"
//             onError={e => log('Preview video error:', e)}
//           />
//         )}

//         {/* Top overlay (safe area) */}
//         <View
//           pointerEvents="box-none"
//           style={[styles.topOverlay, { paddingTop: insets.top + 6 }]}
//         >
//           {device?.hasFlash && !photo && !videoFile && (
//             <TouchableOpacity
//               onPress={cycleFlash}
//               style={[
//                 styles.roundBtn,
//                 { left: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
//               ]}
//             >
//               {flashMode === 'off' && (
//                 <Icon name="flash-off" size={28} color="#fff" />
//               )}
//               {flashMode === 'flash' && (
//                 <Icon name="flash" size={28} color="#fff" />
//               )}
//               {flashMode === 'torch' && (
//                 <Icon name="flashlight" size={28} color="#fff" />
//               )}
//             </TouchableOpacity>
//           )}

//           {/* Aspect ratio toggle */}
//           {!photo && !videoFile && (
//             <View style={styles.aspectWrap}>
//               {ASPECTS.map(a => (
//                 <TouchableOpacity
//                   key={a.key}
//                   onPress={() => {
//                     setAspectKey(a.key);
//                     log('Aspect set:', a.key, a.ratio);
//                   }}
//                   style={[
//                     styles.aspectBtn,
//                     aspectKey === a.key && {
//                       backgroundColor: 'rgba(255,255,255,0.15)',
//                     },
//                   ]}
//                 >
//                   <Text
//                     style={{
//                       color: '#fff',
//                       fontWeight: aspectKey === a.key ? 'bold' : 'normal',
//                       fontSize: 12,
//                     }}
//                   >
//                     {a.label}
//                   </Text>
//                 </TouchableOpacity>
//               ))}
//             </View>
//           )}

//           {/* Switch camera */}
//           {!photo && !videoFile && (
//             <TouchableOpacity
//               onPress={switchCamera}
//               style={[
//                 styles.roundBtn,
//                 { right: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
//               ]}
//             >
//               <Icon name="camera-reverse" size={28} color="#fff" />
//             </TouchableOpacity>
//           )}
//         </View>

//         {/* Right control panel */}
//         {!photo && !videoFile && (
//           <View style={styles.rightPanel}>
//             {/* Grid toggle */}
//             <TouchableOpacity
//               style={[styles.toggleBtn, showGrid && styles.toggleBtnOn]}
//               onPress={() => setShowGrid(v => !v)}
//             >
//               <Icon name="grid-outline" size={18} color="#fff" />
//               <Text style={styles.toggleTxt}>
//                 {showGrid ? 'Grid On' : 'Grid Off'}
//               </Text>
//             </TouchableOpacity>

//             {/* Timer */}
//             <View style={styles.timerRow}>
//               {TIMERS.map(t => (
//                 <TouchableOpacity
//                   key={t}
//                   style={[styles.timerBtn, timer === t && styles.timerBtnOn]}
//                   onPress={() => {
//                     setTimer(t);
//                     log('Timer set:', t);
//                   }}
//                 >
//                   <Text style={styles.timerTxt}>
//                     {t === 0 ? 'OFF' : `${t}s`}
//                   </Text>
//                 </TouchableOpacity>
//               ))}
//             </View>
//           </View>
//         )}

//         {/* Bottom overlay */}
//         <View
//           pointerEvents="box-none"
//           style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 12 }]}
//         >
//           {/* Mode switch above shutter */}
//           {!photo && !videoFile && (
//             <View style={styles.modeRow}>
//               <TouchableOpacity
//                 onPress={() => {
//                   setMode('photo');
//                   log('Mode -> photo');
//                 }}
//                 style={[
//                   styles.modeBtn,
//                   mode === 'photo' && styles.modeBtnActive,
//                 ]}
//               >
//                 <Text
//                   style={[
//                     styles.modeTxt,
//                     mode === 'photo' && styles.modeTxtActive,
//                   ]}
//                 >
//                   PHOTO
//                 </Text>
//               </TouchableOpacity>
//               <TouchableOpacity
//                 onPress={() => {
//                   setMode('video');
//                   log('Mode -> video');
//                 }}
//                 style={[
//                   styles.modeBtn,
//                   mode === 'video' && styles.modeBtnActive,
//                 ]}
//               >
//                 <Text
//                   style={[
//                     styles.modeTxt,
//                     mode === 'video' && styles.modeTxtActive,
//                   ]}
//                 >
//                   VIDEO
//                 </Text>
//               </TouchableOpacity>
//             </View>
//           )}

//           {!photo && !videoFile ? (
//             <>
//               {/* Shutter / Record */}
//               {mode === 'photo' ? (
//                 <TouchableOpacity
//                   style={[styles.shutterBtn, { backgroundColor: shutterColor }]}
//                   onPress={takePhoto}
//                   activeOpacity={0.9}
//                 >
//                   <Icon name="ellipse" size={60} color="#fff" />
//                 </TouchableOpacity>
//               ) : (
//                 <TouchableOpacity
//                   style={[
//                     styles.shutterBtn,
//                     { backgroundColor: isRecording ? '#D32F2F' : '#FF3D00' },
//                   ]}
//                   onPress={isRecording ? stopRecording : startRecording}
//                   activeOpacity={0.9}
//                 >
//                   <Icon
//                     name={isRecording ? 'square' : 'radio-button-on'}
//                     size={60}
//                     color="#fff"
//                   />
//                 </TouchableOpacity>
//               )}

//               {/* Countdown bubble / Recording time */}
//               {mode === 'photo' && countdown > 0 && (
//                 <View style={styles.countdownBubble}>
//                   <Text
//                     style={{ color: '#fff', fontSize: 24, fontWeight: 'bold' }}
//                   >
//                     {countdown}
//                   </Text>
//                 </View>
//               )}
//               {mode === 'video' && isRecording && (
//                 <View style={styles.countdownBubble}>
//                   <Text
//                     style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}
//                   >
//                     ● {Math.floor(recordSecs / 60)}:
//                     {String(recordSecs % 60).padStart(2, '0')}
//                   </Text>
//                 </View>
//               )}
//             </>
//           ) : (
//             <View style={styles.actionRow}>
//               <TouchableOpacity
//                 style={[styles.actionBtn, { backgroundColor: '#fff' }]}
//                 onPress={retake}
//               >
//                 <Icon name="refresh" size={24} color={shutterColor} />
//                 <Text style={{ color: shutterColor, marginTop: 4 }}>
//                   Retake
//                 </Text>
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={[styles.actionBtn, { backgroundColor: shutterColor }]}
//                 onPress={saveCurrent}
//                 disabled={isSaving}
//               >
//                 <Icon name="checkmark" size={24} color="#fff" />
//                 <Text style={{ color: '#fff', marginTop: 4 }}>
//                   {isSaving ? 'Saving...' : 'Save'}
//                 </Text>
//               </TouchableOpacity>
//             </View>
//           )}
//         </View>
//       </View>
//     </SafeAreaView>
//   );
// };

// const styles = StyleSheet.create({
//   loader: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#000',
//     paddingHorizontal: 16,
//   },
//   camera: { width: '100%', height: '100%' },

//   // Center preview vertically for fixed aspect ratios
//   centerWrap: {
//     flex: 1,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   previewContainer: {
//     width: '100%',
//     backgroundColor: '#000',
//   },

//   topOverlay: {
//     position: 'absolute',
//     top: 0,
//     left: 0,
//     right: 0,
//     height: 72,
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//   },
//   roundBtn: {
//     position: 'absolute',
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },

//   aspectWrap: {
//     position: 'absolute',
//     top: 8,
//     left: '25%',
//     right: '25%',
//     backgroundColor: 'rgba(0,0,0,0.35)',
//     borderRadius: 14,
//     paddingHorizontal: 6,
//     paddingVertical: 4,
//     flexDirection: 'row',
//     justifyContent: 'space-evenly',
//     alignItems: 'center',
//     gap: 4,
//   },
//   aspectBtn: {
//     paddingHorizontal: 10,
//     paddingVertical: 6,
//     borderRadius: 10,
//   },

//   rightPanel: {
//     position: 'absolute',
//     right: 8,
//     top: 90,
//     padding: 6,
//     alignItems: 'center',
//     gap: 8,
//   },
//   toggleBtn: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: 'rgba(0,0,0,0.35)',
//     paddingVertical: 6,
//     paddingHorizontal: 8,
//     borderRadius: 12,
//     gap: 6,
//   },
//   toggleBtnOn: {
//     backgroundColor: 'rgba(255,255,255,0.2)',
//   },
//   toggleTxt: { color: '#fff', fontSize: 12 },

//   timerRow: {
//     flexDirection: 'row',
//     gap: 6,
//     backgroundColor: 'rgba(0,0,0,0.35)',
//     borderRadius: 12,
//     padding: 4,
//   },
//   timerBtn: {
//     paddingVertical: 6,
//     paddingHorizontal: 8,
//     borderRadius: 10,
//   },
//   timerBtnOn: {
//     backgroundColor: 'rgba(255,255,255,0.18)',
//   },
//   timerTxt: { color: '#fff', fontSize: 12 },

//   bottomOverlay: {
//     position: 'absolute',
//     left: 0,
//     right: 0,
//     bottom: 0,
//     alignItems: 'center',
//   },
//   modeRow: {
//     flexDirection: 'row',
//     backgroundColor: 'rgba(0,0,0,0.35)',
//     borderRadius: 16,
//     paddingHorizontal: 6,
//     paddingVertical: 4,
//     gap: 6,
//     marginBottom: 6,
//   },
//   modeBtn: {
//     paddingHorizontal: 14,
//     paddingVertical: 6,
//     borderRadius: 12,
//   },
//   modeBtnActive: {
//     backgroundColor: 'rgba(255,255,255,0.2)',
//   },
//   modeTxt: { color: '#fff', fontSize: 12 },
//   modeTxtActive: { fontWeight: 'bold', color: '#fff' },

//   shutterBtn: {
//     width: 96,
//     height: 96,
//     borderRadius: 48,
//     alignItems: 'center',
//     justifyContent: 'center',
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.18,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 2 },
//     marginTop: 6,
//     marginBottom: 6,
//   },
//   actionRow: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     width: '72%',
//   },
//   actionBtn: {
//     alignItems: 'center',
//     justifyContent: 'center',
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderRadius: 14,
//     minWidth: 110,
//     elevation: 2,
//   },
//   smallBtn: {
//     marginTop: 16,
//     borderWidth: 1,
//     borderRadius: 10,
//     paddingVertical: 8,
//     paddingHorizontal: 12,
//   },

//   // Grid lines
//   gridLine: {
//     position: 'absolute',
//     left: 0,
//     right: 0,
//     height: 1,
//     backgroundColor: 'rgba(255,255,255,0.3)',
//   },
//   gridLineV: {
//     position: 'absolute',
//     top: 0,
//     bottom: 0,
//     width: 1,
//     backgroundColor: 'rgba(255,255,255,0.3)',
//   },

//   // Focus ring
//   focusRing: {
//     position: 'absolute',
//     width: 80,
//     height: 80,
//     borderRadius: 40,
//     borderWidth: 2,
//     borderColor: '#FFD54F',
//     backgroundColor: 'transparent',
//   },

//   // Vertical sliders (rotated)
//   leftSliderWrap: {
//     position: 'absolute',
//     left: 6,
//     top: 90,
//     bottom: 140,
//     width: 44,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   rightSliderWrap: {
//     position: 'absolute',
//     right: 6,
//     top: 90,
//     bottom: 140,
//     width: 44,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   vSliderShell: {
//     width: 200,
//     height: 44,
//     transform: [{ rotate: '-90deg' }],
//     alignItems: 'stretch',
//     justifyContent: 'center',
//   },
//   vSlider: { width: '100%', height: 44 },
//   vSliderLabel: {
//     color: '#fff',
//     fontSize: 11,
//     marginTop: 6,
//     textAlign: 'center',
//   },

//   // Temp EV near focus ring
//   tempEVWrap: {
//     position: 'absolute',
//     width: 44,
//     alignItems: 'center',
//   },

//   countdownBubble: {
//     position: 'absolute',
//     bottom: 120,
//     alignSelf: 'center',
//     paddingVertical: 8,
//     paddingHorizontal: 14,
//     backgroundColor: 'rgba(0,0,0,0.5)',
//     borderRadius: 16,
//   },
// });

// export default CameraScreen;
