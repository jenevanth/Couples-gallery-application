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
  Dimensions,
  Animated,
  Modal,
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
import LinearGradient from 'react-native-linear-gradient';

// Optional: device screen brightness (we do NOT change it; kept to avoid runtime errors)
let ScreenBrightness = null;
try {
  ScreenBrightness = require('react-native-screen-brightness').default;
} catch (e) {
  console.log('[Camera] ScreenBrightness not installed; skipping.');
}

const log = (...a) => console.log('[Camera]', ...a);
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const ASPECTS = [
  { key: 'full', label: 'FULL', ratio: 0 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
];

const TIMERS = [0, 3, 10];
const FPS_CHOICES = [24, 30, 60];

// Helpers to read dimensions from VisionCamera format safely
const getPhotoW = f =>
  f?.photoWidth ?? f?.photo?.width ?? f?.photoDimensions?.width ?? 0;
const getPhotoH = f =>
  f?.photoHeight ?? f?.photo?.height ?? f?.photoDimensions?.height ?? 0;
const getVideoW = f =>
  f?.videoWidth ?? f?.video?.width ?? f?.videoDimensions?.width ?? 0;
const getVideoH = f =>
  f?.videoHeight ?? f?.video?.height ?? f?.videoDimensions?.height ?? 0;

const getFpsRange = f => {
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
};

// IMPROVED: Format selector for both photo and video quality consistency
const pickStableFormats = (device, cameraPosition) => {
  if (!device?.formats?.length)
    return {
      photo: null,
      video: null,
      fpsRange: { min: 1, max: 60 },
      chosenFps: cameraPosition === 'front' ? 24 : 30,
    };

  const desiredFps = cameraPosition === 'front' ? 24 : 30;
  const desiredW = 1920;
  const desiredH = 1080;

  // Photo format selection - prefer 1080p-2K range for better quality
  let bestPhoto = null;
  let bestPhotoScore = Number.POSITIVE_INFINITY;

  for (const f of device.formats) {
    const pW = getPhotoW(f);
    const pH = getPhotoH(f);
    if (!pW || !pH) continue;

    const targetArea = desiredW * desiredH;
    const area = pW * pH;

    // Prefer ~1080p-2K range (avoid super high which can look worse on some HALs)
    const areaPenalty =
      area > targetArea * 2.5
        ? Math.abs(area - targetArea * 2) / targetArea
        : Math.abs(area - targetArea) / targetArea;

    // Prefer 16:9 or 4:3
    const ratio = pW / pH;
    const ratioPenalty = Math.min(
      Math.abs(ratio - 16 / 9),
      Math.abs(ratio - 4 / 3),
    );

    const score = areaPenalty + ratioPenalty;

    if (score < bestPhotoScore) {
      bestPhotoScore = score;
      bestPhoto = f;
    }
  }

  // Video format selection
  let bestVideo = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestRange = { min: 1, max: 60 };

  for (const f of device.formats) {
    const vW = getVideoW(f);
    const vH = getVideoH(f);
    if (!vW || !vH) continue;

    const range = getFpsRange(f);
    if (!(range.min <= desiredFps && desiredFps <= range.max)) continue;

    const targetArea = desiredW * desiredH;
    const area = vW * vH;
    const areaPenalty = Math.abs(area - targetArea) / targetArea;

    const ratio = vW && vH ? vW / vH : 16 / 9;
    const ratioPenalty = Math.abs(ratio - 16 / 9);

    const supportsHdr = !!f?.supportsVideoHdr;
    const hdrPenalty = cameraPosition === 'front' && supportsHdr ? 1 : 0;

    const colorSpaces = f?.colorSpaces || f?.supportedColorSpaces || [];
    const srgbBonus =
      Array.isArray(colorSpaces) && colorSpaces.includes('srgb') ? -0.05 : 0;

    const frontHiResPenalty =
      cameraPosition === 'front' && area > targetArea ? 0.5 : 0;

    const score =
      areaPenalty + ratioPenalty + hdrPenalty + frontHiResPenalty + srgbBonus;

    if (score < bestScore) {
      bestScore = score;
      bestVideo = f;
      bestRange = range;
    }
  }

  if (!bestVideo) {
    for (const f of device.formats) {
      const range = getFpsRange(f);
      const fallbackFps = cameraPosition === 'front' ? 24 : 30;
      if (range.min <= fallbackFps && fallbackFps <= range.max) {
        bestVideo = f;
        bestRange = range;
        break;
      }
    }
  }

  const chosenFps = clamp(
    cameraPosition === 'front' ? 24 : 30,
    bestRange.min,
    bestRange.max,
  );

  log('pickStableFormats =>', {
    cameraPosition,
    chosenFps,
    bestPhoto: bestPhoto
      ? { pW: getPhotoW(bestPhoto), pH: getPhotoH(bestPhoto) }
      : null,
    bestVideo: bestVideo
      ? { vW: getVideoW(bestVideo), vH: getVideoH(bestVideo), range: bestRange }
      : null,
  });

  return { photo: bestPhoto, video: bestVideo, fpsRange: bestRange, chosenFps };
};

const CameraScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  const camera = useRef(null);
  const [hasPermission, setHasPermission] = useState(null);
  const [hasMicPermission, setHasMicPermission] = useState(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const zoomIndicatorOpacity = useRef(new Animated.Value(0)).current;

  // Capture states
  const [photo, setPhoto] = useState(null); // still preview state (kept)
  const [isSaving, setIsSaving] = useState(false);

  // User
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState('me');

  // Camera mode/state
  const [cameraPosition, setCameraPosition] = useState('back');
  const [flashMode, setFlashMode] = useState('off');
  const [mode, setMode] = useState('photo');
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

  // Focus UI
  const [focusUI, setFocusUI] = useState({ visible: false, x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const [camLayout, setCamLayout] = useState({
    w: SCREEN_WIDTH,
    h: SCREEN_HEIGHT,
  });

  // Formats
  const device = useCameraDevice(cameraPosition);
  const devicesList = useCameraDevices();
  const [bestPhotoFormat, setBestPhotoFormat] = useState(null);
  const [bestVideoFormat, setBestVideoFormat] = useState(null);
  const [videoFps, setVideoFps] = useState(30);
  const [videoFpsRange, setVideoFpsRange] = useState({ min: 1, max: 60 });

  // Video review modal after recording
  const [videoReviewVisible, setVideoReviewVisible] = useState(false);
  const [videoReviewPath, setVideoReviewPath] = useState('');

  // Animate on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // Hide tab bar here
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent?.();
      parent?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => parent?.setOptions({ tabBarStyle: undefined });
    }, [navigation]),
  );

  const shutterColor =
    profile === 'me' ? COLORS.blue.primary : COLORS.pink.primary;

  // Zoom indicator
  const showZoomIndicator = () => {
    Animated.timing(zoomIndicatorOpacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setTimeout(() => {
        Animated.timing(zoomIndicatorOpacity, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }).start();
      }, 800);
    });
  };

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

  // Auth + profile
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

  // Stable format selection
  useEffect(() => {
    if (!device) {
      setBestPhotoFormat(null);
      setBestVideoFormat(null);
      return;
    }
    const { photo, video, fpsRange, chosenFps } = pickStableFormats(
      device,
      cameraPosition,
    );
    setBestPhotoFormat(photo);
    setBestVideoFormat(video);
    setVideoFpsRange(fpsRange);
    setVideoFps(chosenFps);
  }, [device, cameraPosition]);

  const cycleFlash = () => {
    setFlashMode(prev => {
      const next =
        prev === 'off' ? 'flash' : prev === 'flash' ? 'torch' : 'off';
      log('Flash mode:', next);
      return next;
    });
  };

  const switchCamera = () => {
    if (isRecording) {
      stopRecording().finally(() => {
        setCameraPosition(prev => (prev === 'back' ? 'front' : 'back'));
      });
      return;
    }
    setCameraPosition(prev => (prev === 'back' ? 'front' : 'back'));
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
        log('Exposure not supported on this device.');
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

  // Tap to focus/expose (single tap only; pinch passes to Camera)
  const onTapOverlayStartCapture = e => {
    const touches = e.nativeEvent.touches || [];
    return touches.length === 1;
  };
  const onTapOverlayMoveCapture = () => false;
  const onTapOverlayRelease = async e => {
    const now = Date.now();
    const doubleTap = now - (lastTapRef.current || 0) < 300;
    lastTapRef.current = now;

    const { locationX, locationY } = e.nativeEvent;
    if (!camLayout.w || !camLayout.h) return;

    if (doubleTap) {
      // toggle between ~1x and ~2x
      const neutral =
        typeof device?.neutralZoom === 'number' ? device.neutralZoom : 1;
      const target = zoom < neutral * 1.9 ? neutral * 2 : neutral;
      const minZ = typeof device?.minZoom === 'number' ? device.minZoom : 1;
      const maxZ = typeof device?.maxZoom === 'number' ? device.maxZoom : 4;
      setZoom(clamp(target, minZ, maxZ));
      showZoomIndicator();
      return;
    }

    const xNorm = clamp(locationX / camLayout.w, 0, 1);
    const yNorm = clamp(locationY / camLayout.h, 0, 1);

    setFocusUI({ visible: true, x: locationX, y: locationY });
    setTimeout(() => setFocusUI(f => ({ ...f, visible: false })), 1500);

    try {
      if (camera.current?.focus)
        await camera.current.focus({ x: xNorm, y: yNorm });
      if (camera.current?.setExposurePoint)
        await camera.current.setExposurePoint({ x: xNorm, y: yNorm });
      log('Tap focus/expose at:', { xNorm, yNorm });
    } catch (err) {
      log('Tap focus/expose error:', err);
    }
  };

  // Countdown
  const runCountdownIfNeeded = async () => {
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
  };

  // Take photo (photo mode)
  const takePhoto = async () => {
    if (!camera.current) return;

    await runCountdownIfNeeded();

    try {
      const flashParam =
        flashMode === 'flash' && device?.hasFlash && cameraPosition !== 'front'
          ? 'on'
          : 'off';

      log('takePhoto ->', { flashParam, zoom, ev });

      const result = await camera.current.takePhoto({
        flash: flashParam,
        qualityPrioritization: 'balanced',
        enableShutterSound: false,
        enableAutoStabilization: true,
      });

      setPhoto(result); // enter preview mode for photo
      log('Photo taken:', result);
    } catch (e) {
      Alert.alert('Camera Error', e?.message || String(e));
      log('Error takePhoto:', e);
    }
  };

  // Photo while recording
  // Photo while recording - AUTO-SAVE without preview
  const takePhotoWhileRecording = async () => {
    if (!camera.current || !isRecording) return;
    try {
      const result = await camera.current.takePhoto({
        flash: 'off',
        qualityPrioritization: 'balanced',
      });

      // DON'T set photo state - directly save in background
      log('Photo during recording:', result);

      // Auto-save in background
      const photoPath =
        Platform.OS === 'android' ? 'file://' + result.path : result.path;
      uploadPhotoPath(photoPath)
        .then(() => {
          log('Photo auto-saved while recording');
          // Optional: Show a brief toast/indicator that photo was saved
          Alert.alert('', 'Photo saved!', [{ text: 'OK' }], {
            cancelable: true,
          });
        })
        .catch(e => {
          log('Auto-save error during recording:', e);
          // Silently fail or show brief error
        });
    } catch (e) {
      log('takePhotoWhileRecording error:', e);
      Alert.alert(
        'Not Supported',
        'This device may not support photos while recording.',
      );
    }
  };

  // Recording start/stop: show review modal after finish
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

      // Front low-light -> prefer 24fps
      if (cameraPosition === 'front' && videoFps > 24) {
        const newFps = clamp(24, videoFpsRange.min, videoFpsRange.max);
        setVideoFps(newFps);
        log('Front: FPS -> 24 for brightness.');
      }

      await camera.current.startRecording({
        fileType: 'mp4',
        onRecordingFinished: video => {
          try {
            clearInterval(recordTimerRef.current);
          } catch {}
          setIsRecording(false);

          if (!video?.path) {
            log('Recording finished with no path.');
            return;
          }

          // Open review modal for Save / Delete
          setVideoReviewPath(video.path);
          setVideoReviewVisible(true);
          log('Recording finished; opening review modal:', video.path);
        },
        onRecordingError: error => {
          try {
            clearInterval(recordTimerRef.current);
          } catch {}
          setIsRecording(false);
          log('Recording error:', error);
          Alert.alert('Record Error', error?.message || String(error));
        },
      });
    } catch (e) {
      log('startRecording exception:', e);
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!camera.current || !isRecording) return;
    try {
      log('stopRecording...');
      await camera.current.stopRecording();
    } catch (e) {
      log('stopRecording error (ignored):', e?.message || e);
    } finally {
      try {
        clearInterval(recordTimerRef.current);
      } catch {}
    }
  };

  // Upload helpers
  const uploadPhotoPath = async photoPath => {
    const signatureData = await fetch(
      'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
    ).then(res => res.json());
    log('Got ImageKit signature:', signatureData);

    const fileName = photoPath.split('/').pop() || `photo_${Date.now()}.jpg`;
    const wrappedPath = BlobUtil.wrap(photoPath.replace(/^file:\/\//, ''));

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
      log('Supabase insert error:', supabaseError);
      throw new Error(supabaseError?.message || 'Insert failed');
    }

    // Notification
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
  };

  const uploadVideoFile = async videoPath => {
    const signatureData = await fetch(
      'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
    ).then(res => res.json());
    log('Got ImageKit signature:', signatureData);

    const baseName = videoPath.split('/').pop() || `video_${Date.now()}.mp4`;
    const fileName = baseName.endsWith('.mp4') ? baseName : `${baseName}.mp4`;
    const wrappedPath = BlobUtil.wrap(videoPath.replace(/^file:\/\//, ''));

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
      log('Supabase insert error:', supabaseError);
      throw new Error(supabaseError?.message || 'Insert failed');
    }

    // Notification
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
  };

  // Save/Retake for photo (kept)
  const saveCurrent = async () => {
    if (photo?.path) return savePhoto();
  };
  const savePhoto = async () => {
    if (!photo?.path) return;
    setIsSaving(true);
    try {
      const path =
        Platform.OS === 'android' ? 'file://' + photo.path : photo.path;
      await uploadPhotoPath(path);
      Alert.alert('Saved!', 'Photo saved to gallery.');
      setPhoto(null);
    } catch (e) {
      Alert.alert('Save Error', e?.message || String(e));
    } finally {
      setIsSaving(false);
    }
  };
  const retake = () => {
    setPhoto(null);
    log('Retake/reset photo preview');
  };

  // Video review modal actions
  const confirmSaveVideo = async () => {
    try {
      setIsSaving(true);
      await uploadVideoFile(videoReviewPath);
      setIsSaving(false);
      setVideoReviewVisible(false);
      setVideoReviewPath('');
      Alert.alert('Saved!', 'Video saved to gallery.');
    } catch (e) {
      setIsSaving(false);
      Alert.alert('Upload Error', e?.message || String(e));
    }
  };
  const discardVideo = () => {
    setVideoReviewVisible(false);
    setVideoReviewPath('');
    log('Video discarded by user');
  };

  // UI rendering

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

  const isCameraActive = isFocused && !!device && !photo; // keep preview on unless showing photo preview

  const torchValue =
    cameraPosition === 'front'
      ? 'off'
      : flashMode === 'torch' && device?.hasFlash
      ? 'on'
      : 'off';

  const camHeight = getCameraHeight();
  const minZ = typeof device.minZoom === 'number' ? device.minZoom : 1;
  const maxZ = typeof device.maxZoom === 'number' ? device.maxZoom : 4;

  const edgeLightOpacity = 0; // we’re not brightening screen

  const currentFormat = mode === 'video' ? bestVideoFormat : bestPhotoFormat;
  const fpsToUse =
    mode === 'video'
      ? clamp(videoFps, videoFpsRange.min, videoFpsRange.max)
      : undefined;

  const videoHdr = false;
  const videoStabilizationMode =
    cameraPosition === 'front' ? 'off' : 'standard';

  // Zoom preset bar: 2x, 3x, 5x, 10x above mode selector
  const neutral =
    typeof device?.neutralZoom === 'number' ? device.neutralZoom : 1;
  const factorToZoom = f => clamp(neutral * f, minZ, maxZ);
  const zoomPresets = [2, 3, 5, 10].map(f => ({
    factor: f,
    value: factorToZoom(f),
    supported: factorToZoom(f) <= maxZ && factorToZoom(f) >= minZ,
  }));

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: '#000' }}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <View style={{ flex: 1 }}>
        {/* Preview block */}
        <View style={styles.centerWrap}>
          <View
            style={[
              styles.previewContainer,
              {
                height: aspectKey === 'full' ? '100%' : camHeight,
                width: '100%',
              },
            ]}
          >
            {/* Tap overlay: single finger -> focus; multi-touch passes to Camera for pinch */}
            <View
              style={StyleSheet.absoluteFill}
              onStartShouldSetResponderCapture={onTapOverlayStartCapture}
              onMoveShouldSetResponderCapture={onTapOverlayMoveCapture}
              onResponderRelease={onTapOverlayRelease}
            />

            <Camera
              ref={camera}
              style={styles.camera}
              device={device}
              isActive={isCameraActive}
              photo
              video={mode === 'video'}
              torch={torchValue}
              enableZoomGesture
              zoom={zoom}
              onInitialized={() => log('Camera initialized')}
              onError={e => log('Camera onError:', e)}
              format={currentFormat || undefined}
              fps={fpsToUse}
              whiteBalance="auto"
              videoHdr={videoHdr}
              videoStabilizationMode={videoStabilizationMode}
            />

            {/* Grid */}
            {showGrid && (
              <>
                <View style={[styles.gridLine, { top: '33.33%' }]} />
                <View style={[styles.gridLine, { top: '66.66%' }]} />
                <View style={[styles.gridLineV, { left: '33.33%' }]} />
                <View style={[styles.gridLineV, { left: '66.66%' }]} />
              </>
            )}

            {/* Focus ring */}
            {focusUI.visible && (
              <View
                style={[
                  styles.focusRing,
                  { left: focusUI.x - 40, top: focusUI.y - 40 },
                ]}
              />
            )}

            {/* Left exposure slider */}
            <View style={styles.leftSliderWrap}>
              <View style={styles.vSliderShell}>
                <Slider
                  style={styles.vSlider}
                  value={ev}
                  minimumValue={-2}
                  maximumValue={2}
                  step={0.05}
                  minimumTrackTintColor="#FFD700"
                  maximumTrackTintColor="rgba(255,255,255,0.3)"
                  thumbTintColor="#FFD700"
                  onValueChange={v => applyExposure(v)}
                />
              </View>
              <Text style={styles.vSliderLabel}>{`${ev.toFixed(1)} EV`}</Text>
            </View>

            {/* Right zoom slider */}
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
                  onValueChange={v => {
                    setZoom(v);
                    showZoomIndicator();
                  }}
                />
              </View>
              <Text style={styles.vSliderLabel}>{`${zoom.toFixed(2)}x`}</Text>
            </View>

            {/* Zoom indicator */}
            <Animated.View
              style={[styles.zoomIndicator, { opacity: zoomIndicatorOpacity }]}
              pointerEvents="none"
            >
              <Text style={styles.zoomText}>{zoom.toFixed(1)}x</Text>
            </Animated.View>
          </View>
        </View>

        {/* Top bar */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.topOverlay,
            { paddingTop: insets.top + 10, opacity: fadeAnim },
          ]}
        >
          {/* Flash (back only) */}
          <View style={styles.topControlsRow}>
            {device?.hasFlash && cameraPosition !== 'front' ? (
              <TouchableOpacity
                onPress={cycleFlash}
                style={styles.topControlBtn}
              >
                {flashMode === 'off' && (
                  <Icon name="flash-off" size={24} color="#fff" />
                )}
                {flashMode === 'flash' && (
                  <Icon name="flash" size={24} color="#FFD700" />
                )}
                {flashMode === 'torch' && (
                  <Icon name="flashlight" size={24} color="#FFD700" />
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.topControlBtn} />
            )}

            {/* Aspect + Timer + Grid */}
            <View style={styles.topCenterControls}>
              <TouchableOpacity
                onPress={() => {
                  const idx = ASPECTS.findIndex(a => a.key === aspectKey);
                  const nextIdx = (idx + 1) % ASPECTS.length;
                  setAspectKey(ASPECTS[nextIdx].key);
                }}
                style={styles.topControlBtn}
              >
                <Text style={styles.aspectText}>
                  {ASPECTS.find(a => a.key === aspectKey)?.label}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  const idx = TIMERS.indexOf(timer);
                  const nextIdx = (idx + 1) % TIMERS.length;
                  setTimer(TIMERS[nextIdx]);
                }}
                style={styles.topControlBtn}
              >
                <Icon
                  name="timer-outline"
                  size={24}
                  color={timer > 0 ? '#FFD700' : '#fff'}
                />
                {timer > 0 && <Text style={styles.timerBadge}>{timer}s</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowGrid(!showGrid)}
                style={styles.topControlBtn}
              >
                <Icon
                  name="grid-outline"
                  size={24}
                  color={showGrid ? '#FFD700' : '#fff'}
                />
              </TouchableOpacity>
            </View>

            {/* Switch camera */}
            <TouchableOpacity
              onPress={switchCamera}
              style={styles.topControlBtn}
            >
              <Icon name="camera-reverse-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Bottom overlay */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.bottomOverlay,
            { paddingBottom: insets.bottom + 20, opacity: fadeAnim },
          ]}
        >
          {!photo ? (
            <>
              {/* Zoom presets bar (2x / 3x / 5x / 10x) */}
              <View style={styles.zoomPresetBar}>
                {zoomPresets.map(p => (
                  <TouchableOpacity
                    key={p.factor}
                    disabled={!p.supported}
                    onPress={() => {
                      setZoom(p.value);
                      showZoomIndicator();
                    }}
                    style={[
                      styles.zoomPresetChip,
                      !p.supported && { opacity: 0.35 },
                      Math.abs(zoom - p.value) < 0.1 &&
                        styles.zoomPresetChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.zoomPresetChipText,
                        Math.abs(zoom - p.value) < 0.1 &&
                          styles.zoomPresetChipTextActive,
                      ]}
                    >
                      {p.factor}x
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Mode selector */}
              <View style={styles.modeSelector}>
                <TouchableOpacity
                  onPress={() => setMode('photo')}
                  style={[
                    styles.modeOption,
                    mode === 'photo' && styles.modeOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeText,
                      mode === 'photo' && styles.modeTextActive,
                    ]}
                  >
                    PHOTO
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setMode('video')}
                  style={[
                    styles.modeOption,
                    mode === 'video' && styles.modeOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeText,
                      mode === 'video' && styles.modeTextActive,
                    ]}
                  >
                    VIDEO
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Main controls */}
              <View style={styles.mainControls}>
                {/* Photo while recording button (left) */}
                {mode === 'video' && isRecording ? (
                  <TouchableOpacity
                    onPress={takePhotoWhileRecording}
                    style={styles.galleryBtn}
                  >
                    <Icon name="camera" size={24} color="#fff" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => navigation.navigate('Gallery')}
                    style={styles.galleryBtn}
                  >
                    <Icon name="images-outline" size={24} color="#fff" />
                  </TouchableOpacity>
                )}

                {/* Shutter */}
                {mode === 'photo' ? (
                  <TouchableOpacity
                    onPress={takePhoto}
                    activeOpacity={0.7}
                    style={styles.shutterContainer}
                  >
                    <LinearGradient
                      colors={[shutterColor, shutterColor + 'DD']}
                      style={styles.shutterButton}
                    >
                      <View style={styles.shutterInner} />
                    </LinearGradient>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={isRecording ? stopRecording : startRecording}
                    activeOpacity={0.7}
                    style={styles.shutterContainer}
                  >
                    <LinearGradient
                      colors={
                        isRecording
                          ? ['#FF3D00', '#D32F2F']
                          : ['#FF5252', '#FF3D00']
                      }
                      style={styles.shutterButton}
                    >
                      <View
                        style={[
                          styles.shutterInner,
                          isRecording && styles.recordingInner,
                        ]}
                      />
                    </LinearGradient>
                  </TouchableOpacity>
                )}

                {/* Switch camera (right) */}
                <TouchableOpacity
                  onPress={switchCamera}
                  style={styles.switchBtn}
                >
                  <Icon name="camera-reverse-outline" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Recording indicator */}
              {isRecording && (
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingTime}>
                    {Math.floor(recordSecs / 60)}:
                    {String(recordSecs % 60).padStart(2, '0')}
                  </Text>
                </View>
              )}

              {/* Countdown bubble */}
              {countdown > 0 && (
                <View style={styles.countdownContainer}>
                  <Text style={styles.countdownText}>{countdown}</Text>
                </View>
              )}
            </>
          ) : (
            // Photo preview actions
            <View style={styles.previewActions}>
              <TouchableOpacity onPress={retake} style={styles.previewBtn}>
                <Icon name="close-circle-outline" size={32} color="#fff" />
                <Text style={styles.previewBtnText}>Retake</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={saveCurrent}
                disabled={isSaving}
                style={[styles.previewBtn, styles.saveBtn]}
              >
                <LinearGradient
                  colors={[shutterColor, shutterColor + 'DD']}
                  style={styles.saveBtnGradient}
                >
                  <Icon name="checkmark-circle" size={32} color="#fff" />
                </LinearGradient>
                <Text style={styles.previewBtnText}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>

        {/* Uploading spinner */}
        {isSaving && (
          <View style={styles.savingOverlay}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: '#fff', marginTop: 8 }}>Uploading...</Text>
          </View>
        )}
      </View>

      {/* Video Review Modal (Save / Delete) */}
      <Modal
        visible={videoReviewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVideoReviewVisible(false)}
      >
        <View style={styles.reviewBackdrop}>
          <View style={styles.reviewContainer}>
            <View style={styles.reviewTopBar}>
              <TouchableOpacity
                onPress={() => setVideoReviewVisible(false)}
                style={styles.reviewTopBtn}
              >
                <Icon name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.reviewVideoWrap}>
              {!!videoReviewPath && (
                <Video
                  source={{
                    uri:
                      Platform.OS === 'android'
                        ? 'file://' + videoReviewPath
                        : videoReviewPath,
                  }}
                  style={{ width: '100%', height: '100%' }}
                  controls
                  paused={false}
                  resizeMode="contain"
                  onError={e => log('Video review error:', e)}
                />
              )}
            </View>

            <View style={styles.reviewActions}>
              <TouchableOpacity
                style={[styles.reviewBtn, { backgroundColor: '#444' }]}
                onPress={discardVideo}
              >
                <Icon name="trash" size={20} color="#fff" />
                <Text style={styles.reviewBtnText}>Delete</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.reviewBtn, { backgroundColor: '#27AE60' }]}
                onPress={confirmSaveVideo}
              >
                <Icon name="cloud-upload" size={20} color="#fff" />
                <Text style={styles.reviewBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// Styles
const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingHorizontal: 16,
  },
  camera: { width: '100%', height: '100%' },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewContainer: { width: '100%', backgroundColor: '#000' },

  // Top overlay
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  topControlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  topCenterControls: { flexDirection: 'row', gap: 12 },
  aspectText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  timerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#FFD700',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000',
  },

  bottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },

  zoomPresetBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    marginBottom: 10,
  },
  zoomPresetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  zoomPresetChipActive: {
    backgroundColor: 'rgba(255,215,0,0.25)',
  },
  zoomPresetChipText: { color: '#eee', fontSize: 12, fontWeight: '700' },
  zoomPresetChipTextActive: { color: '#FFD700' },

  modeSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 20,
    padding: 4,
    marginBottom: 16,
  },
  modeOption: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16 },
  modeOptionActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  modeText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
  modeTextActive: { color: '#fff' },

  mainControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '85%',
    paddingHorizontal: 10,
  },
  galleryBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  shutterContainer: { padding: 4 },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
  },
  recordingInner: {
    borderRadius: 8,
    backgroundColor: '#fff',
    width: 32,
    height: 32,
  },

  switchBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Left/right sliders
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

  // Focus ring, grid
  focusRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FFD700',
    backgroundColor: 'transparent',
  },
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

  // Zoom indicator
  zoomIndicator: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  zoomText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Recording indicator & countdown
  recordingIndicator: {
    position: 'absolute',
    top: -54,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3D00',
    marginRight: 8,
  },
  recordingTime: { color: '#fff', fontSize: 16, fontWeight: '600' },
  countdownContainer: {
    position: 'absolute',
    top: -100,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: { color: '#fff', fontSize: 36, fontWeight: 'bold' },

  // Upload overlay
  savingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 110,
    alignSelf: 'center',
    alignItems: 'center',
  },

  // Review modal (video)
  reviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewContainer: { width: '100%', height: '100%' },
  reviewTopBar: {
    position: 'absolute',
    top: 40,
    left: 10,
    right: 10,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reviewTopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewVideoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  reviewActions: {
    position: 'absolute',
    bottom: 36,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  reviewBtnText: { color: '#fff', fontWeight: '700' },

  smallBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
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
//   Animated,
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
// import LinearGradient from 'react-native-linear-gradient';

// // Optional: device screen brightness (safe, optional)
// let ScreenBrightness = null;
// try {
//   ScreenBrightness = require('react-native-screen-brightness').default;
// } catch (e) {
//   console.log(
//     '[Camera] ScreenBrightness not installed; using light bars only.',
//   );
// }

// const log = (...a) => console.log('[Camera]', ...a);
// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// const ASPECTS = [
//   { key: 'full', label: 'FULL', ratio: 0 },
//   { key: '1:1', label: '1:1', ratio: 1 },
//   { key: '4:3', label: '4:3', ratio: 4 / 3 },
//   { key: '16:9', label: '16:9', ratio: 16 / 9 },
// ];

// const TIMERS = [0, 3, 10];
// const FPS_CHOICES = [24, 30, 60];

// // Helpers to read dimensions from VisionCamera format safely
// const getPhotoW = f =>
//   f?.photoWidth ?? f?.photo?.width ?? f?.photoDimensions?.width ?? 0;
// const getPhotoH = f =>
//   f?.photoHeight ?? f?.photo?.height ?? f?.photoDimensions?.height ?? 0;
// const getVideoW = f =>
//   f?.videoWidth ?? f?.video?.width ?? f?.videoDimensions?.width ?? 0;
// const getVideoH = f =>
//   f?.videoHeight ?? f?.video?.height ?? f?.videoDimensions?.height ?? 0;

// const getFpsRange = f => {
//   let min = 1,
//     max = 60;
//   if (!f) return { min, max };
//   if (typeof f.minFps === 'number') min = f.minFps;
//   if (typeof f.maxFps === 'number') max = f.maxFps;
//   if (Array.isArray(f.frameRateRanges) && f.frameRateRanges.length) {
//     const mins = f.frameRateRanges.map(r => r.minFrameRate || r.minFps || 1);
//     const maxs = f.frameRateRanges.map(r => r.maxFrameRate || r.maxFps || 60);
//     min = Math.min(...mins);
//     max = Math.max(...maxs);
//   }
//   return { min, max };
// };

// // IMPROVED: Format selector for both photo and video quality consistency
// const pickStableFormats = (device, cameraPosition) => {
//   if (!device?.formats?.length)
//     return {
//       photo: null,
//       video: null,
//       fpsRange: { min: 1, max: 60 },
//       chosenFps: cameraPosition === 'front' ? 24 : 30,
//     };

//   const desiredFps = cameraPosition === 'front' ? 24 : 30;
//   const desiredW = 1920;
//   const desiredH = 1080;

//   // IMPROVED: Photo format selection - prefer 1080p-2K range for better quality
//   let bestPhoto = null;
//   let bestPhotoScore = Number.POSITIVE_INFINITY;

//   for (const f of device.formats) {
//     const pW = getPhotoW(f);
//     const pH = getPhotoH(f);
//     if (!pW || !pH) continue;

//     const targetArea = desiredW * desiredH;
//     const area = pW * pH;

//     // Prefer 1080p-2K range (not too high which can reduce quality)
//     const areaPenalty =
//       area > targetArea * 2.5
//         ? Math.abs(area - targetArea * 2) / targetArea
//         : Math.abs(area - targetArea) / targetArea;

//     // Prefer 16:9 or 4:3 aspect ratios
//     const ratio = pW / pH;
//     const ratioPenalty = Math.min(
//       Math.abs(ratio - 16 / 9),
//       Math.abs(ratio - 4 / 3),
//     );

//     const score = areaPenalty + ratioPenalty;

//     if (score < bestPhotoScore) {
//       bestPhotoScore = score;
//       bestPhoto = f;
//     }
//   }

//   // Video format selection (keep existing logic)
//   let bestVideo = null;
//   let bestScore = Number.POSITIVE_INFINITY;
//   let bestRange = { min: 1, max: 60 };

//   for (const f of device.formats) {
//     const vW = getVideoW(f);
//     const vH = getVideoH(f);
//     if (!vW || !vH) continue;

//     const range = getFpsRange(f);
//     if (!(range.min <= desiredFps && desiredFps <= range.max)) continue;

//     const targetArea = desiredW * desiredH;
//     const area = vW * vH;
//     const areaPenalty = Math.abs(area - targetArea) / targetArea;

//     const ratio = vW && vH ? vW / vH : 16 / 9;
//     const ratioPenalty = Math.abs(ratio - 16 / 9);

//     const supportsHdr = !!f?.supportsVideoHdr;
//     const hdrPenalty = cameraPosition === 'front' && supportsHdr ? 1 : 0;

//     const colorSpaces = f?.colorSpaces || f?.supportedColorSpaces || [];
//     const srgbBonus =
//       Array.isArray(colorSpaces) && colorSpaces.includes('srgb') ? -0.05 : 0;

//     const frontHiResPenalty =
//       cameraPosition === 'front' && area > targetArea ? 0.5 : 0;

//     const score =
//       areaPenalty + ratioPenalty + hdrPenalty + frontHiResPenalty + srgbBonus;

//     if (score < bestScore) {
//       bestScore = score;
//       bestVideo = f;
//       bestRange = range;
//     }
//   }

//   if (!bestVideo) {
//     for (const f of device.formats) {
//       const range = getFpsRange(f);
//       const fallbackFps = cameraPosition === 'front' ? 24 : 30;
//       if (range.min <= fallbackFps && fallbackFps <= range.max) {
//         bestVideo = f;
//         bestRange = range;
//         break;
//       }
//     }
//   }

//   const chosenFps = clamp(
//     cameraPosition === 'front' ? 24 : 30,
//     bestRange.min,
//     bestRange.max,
//   );

//   log('pickStableFormats =>', {
//     cameraPosition,
//     chosenFps,
//     bestPhoto: bestPhoto
//       ? { pW: getPhotoW(bestPhoto), pH: getPhotoH(bestPhoto) }
//       : null,
//     bestVideo: bestVideo
//       ? { vW: getVideoW(bestVideo), vH: getVideoH(bestVideo), range: bestRange }
//       : null,
//   });

//   return { photo: bestPhoto, video: bestVideo, fpsRange: bestRange, chosenFps };
// };

// const CameraScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const insets = useSafeAreaInsets();
//   const isFocused = useIsFocused();

//   const camera = useRef(null);
//   const [hasPermission, setHasPermission] = useState(null);
//   const [hasMicPermission, setHasMicPermission] = useState(null);

//   // Animations for UI
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const slideAnim = useRef(new Animated.Value(50)).current;
//   const zoomIndicatorOpacity = useRef(new Animated.Value(0)).current;

//   // Capture states
//   const [photo, setPhoto] = useState(null);
//   const [videoFile, setVideoFile] = useState(null);
//   const [isSaving, setIsSaving] = useState(false);

//   const [userId, setUserId] = useState('');
//   const [profile, setProfile] = useState('me');
//   const [cameraPosition, setCameraPosition] = useState('back');
//   const [flashMode, setFlashMode] = useState('off');

//   // Mode
//   const [mode, setMode] = useState('photo');
//   const [isRecording, setIsRecording] = useState(false);
//   const recordTimerRef = useRef(null);
//   const [recordSecs, setRecordSecs] = useState(0);

//   // Controls
//   const [zoom, setZoom] = useState(1);
//   const [aspectKey, setAspectKey] = useState('full');
//   const [showGrid, setShowGrid] = useState(false);
//   const [ev, setEv] = useState(0);
//   const [timer, setTimer] = useState(0);
//   const [countdown, setCountdown] = useState(0);
//   const [showSettings, setShowSettings] = useState(false);

//   // Tap to focus UI
//   const [focusUI, setFocusUI] = useState({ visible: false, x: 0, y: 0 });
//   const lastTapRef = useRef(0);
//   const [camLayout, setCamLayout] = useState({
//     w: SCREEN_WIDTH,
//     h: SCREEN_HEIGHT,
//   });

//   // Pinch-to-zoom (KEEP ORIGINAL FUNCTIONALITY)
//   const [pinchActive, setPinchActive] = useState(false);
//   const pinchStartDistRef = useRef(0);
//   const pinchStartZoomRef = useRef(1);
//   const zoomIndicatorTimeout = useRef(null);

//   // Formats & FPS selection
//   const device = useCameraDevice(cameraPosition);
//   const devicesList = useCameraDevices();
//   const [bestPhotoFormat, setBestPhotoFormat] = useState(null);
//   const [bestVideoFormat, setBestVideoFormat] = useState(null);
//   const [videoFps, setVideoFps] = useState(30);
//   const [videoFpsRange, setVideoFpsRange] = useState({ min: 1, max: 60 });

//   // Selfie light
//   const [selfieLight, setSelfieLight] = useState(false);
//   const [selfieIntensity, setSelfieIntensity] = useState(0.85);
//   const [lowLightPreset, setLowLightPreset] = useState(false);
//   const [autoLowLightFront, setAutoLowLightFront] = useState(true);
//   const origBrightnessRef = useRef(null);

//   // Animate UI on mount
//   useEffect(() => {
//     Animated.parallel([
//       Animated.timing(fadeAnim, {
//         toValue: 1,
//         duration: 500,
//         useNativeDriver: true,
//       }),
//       Animated.spring(slideAnim, {
//         toValue: 0,
//         friction: 8,
//         useNativeDriver: true,
//       }),
//     ]).start();
//   }, []);

//   // Hide tab bar on this screen
//   useFocusEffect(
//     useCallback(() => {
//       const parent = navigation.getParent?.();
//       parent?.setOptions({ tabBarStyle: { display: 'none' } });
//       return () => parent?.setOptions({ tabBarStyle: undefined });
//     }, [navigation]),
//   );

//   const shutterColor =
//     profile === 'me' ? COLORS.blue.primary : COLORS.pink.primary;

//   // Show zoom indicator temporarily when zooming
//   const showZoomIndicator = () => {
//     if (zoomIndicatorTimeout.current)
//       clearTimeout(zoomIndicatorTimeout.current);

//     Animated.timing(zoomIndicatorOpacity, {
//       toValue: 1,
//       duration: 200,
//       useNativeDriver: true,
//     }).start();

//     zoomIndicatorTimeout.current = setTimeout(() => {
//       Animated.timing(zoomIndicatorOpacity, {
//         toValue: 0,
//         duration: 500,
//         useNativeDriver: true,
//       }).start();
//     }, 2000);
//   };

//   // Log devices + init zoom
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
//         formats: d.formats?.length,
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
//         formats: device.formats?.length,
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

//   // Auth + current profile
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

//   // Permissions
//   useEffect(() => {
//     (async () => {
//       try {
//         const camStatus = await Camera.getCameraPermissionStatus();
//         log('Initial camera perm:', camStatus);
//         if (camStatus !== 'authorized' && camStatus !== 'granted') {
//           const req = await Camera.requestCameraPermission();
//           setHasPermission(req === 'authorized' || req === 'granted');
//           log('Camera permission requested ->', req);
//         } else setHasPermission(true);

//         const micStatus = await Camera.getMicrophonePermissionStatus();
//         log('Initial mic perm:', micStatus);
//         if (micStatus !== 'authorized' && micStatus !== 'granted') {
//           const reqM = await Camera.requestMicrophonePermission();
//           setHasMicPermission(reqM === 'authorized' || reqM === 'granted');
//           log('Microphone permission requested ->', reqM);
//         } else setHasMicPermission(true);
//       } catch (e) {
//         setHasPermission(false);
//         setHasMicPermission(false);
//         log('Permission error:', e);
//       }
//     })();
//   }, []);

//   // Stable format selection
//   useEffect(() => {
//     if (!device) {
//       setBestPhotoFormat(null);
//       setBestVideoFormat(null);
//       return;
//     }
//     const { photo, video, fpsRange, chosenFps } = pickStableFormats(
//       device,
//       cameraPosition,
//     );
//     setBestPhotoFormat(photo);
//     setBestVideoFormat(video);
//     setVideoFpsRange(fpsRange);
//     setVideoFps(chosenFps);
//   }, [device, cameraPosition]);

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
//           'Exposure not supported on this device; using physical light if needed.',
//         );
//       }
//     } catch (e) {
//       log('Exposure apply error:', e);
//     }
//   };

//   const getCameraHeight = () => {
//     const aspect = ASPECTS.find(a => a.key === aspectKey);
//     if (!aspect || aspect.ratio <= 0) return SCREEN_HEIGHT;
//     return SCREEN_WIDTH / aspect.ratio;
//   };

//   const handleTap = async evt => {
//     const now = Date.now();
//     const doubleTap = now - (lastTapRef.current || 0) < 300;
//     lastTapRef.current = now;

//     const { locationX, locationY } = evt.nativeEvent;
//     if (!camLayout.w || !camLayout.h) return;

//     const xNorm = clamp(locationX / camLayout.w, 0, 1);
//     const yNorm = clamp(locationY / camLayout.h, 0, 1);

//     if (doubleTap) {
//       // Double tap to toggle between ~1x and ~2x
//       const neutral =
//         typeof device?.neutralZoom === 'number' ? device.neutralZoom : 1;
//       const target = zoom < neutral * 1.9 ? neutral * 2 : neutral;
//       const minZ = typeof device?.minZoom === 'number' ? device.minZoom : 1;
//       const maxZ = typeof device?.maxZoom === 'number' ? device.maxZoom : 4;
//       setZoom(clamp(target, minZ, maxZ));
//       showZoomIndicator();
//       return;
//     }

//     setFocusUI({ visible: true, x: locationX, y: locationY });
//     setTimeout(() => setFocusUI(f => ({ ...f, visible: false })), 1500);

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

//   // ORIGINAL Pinch-to-zoom functionality (Fix: allow this overlay to receive touches)
//   const distance2 = (t1, t2) => {
//     const dx = t1.pageX - t2.pageX;
//     const dy = t1.pageY - t2.pageY;
//     return Math.sqrt(dx * dx + dy * dy);
//   };

//   const onStartShouldSetResponder = e => {
//     const t = e.nativeEvent.touches;
//     return t && t.length >= 2; // only capture when multi-touch
//   };
//   const onMoveShouldSetResponder = e => {
//     const t = e.nativeEvent.touches;
//     return t && t.length >= 2;
//   };

//   const onResponderGrant = e => {
//     const t = e.nativeEvent.touches;
//     if (t && t.length >= 2) {
//       pinchStartDistRef.current = distance2(t[0], t[1]);
//       pinchStartZoomRef.current = zoom;
//       setPinchActive(true);
//       showZoomIndicator();
//       log('Pinch start:', {
//         dist: pinchStartDistRef.current,
//         zoomStart: pinchStartZoomRef.current,
//       });
//     }
//   };

//   const onResponderMove = e => {
//     const t = e.nativeEvent.touches;
//     if (!pinchActive || !t || t.length < 2) return;
//     const dist = distance2(t[0], t[1]);
//     if (pinchStartDistRef.current > 0) {
//       const scale = dist / pinchStartDistRef.current;
//       const minZ = typeof device?.minZoom === 'number' ? device.minZoom : 1;
//       const maxZ = typeof device?.maxZoom === 'number' ? device.maxZoom : 4;
//       const newZoom = clamp(pinchStartZoomRef.current * scale, minZ, maxZ);
//       setZoom(newZoom);
//       showZoomIndicator();
//     }
//   };

//   const onResponderRelease = () => {
//     if (pinchActive) log('Pinch end. Final zoom:', zoom.toFixed(2));
//     setPinchActive(false);
//   };

//   const restoreScreenBrightness = useCallback(async () => {
//     if (origBrightnessRef.current != null && ScreenBrightness) {
//       try {
//         await ScreenBrightness.setBrightness(origBrightnessRef.current);
//         log('Screen brightness restored to', origBrightnessRef.current);
//       } catch (e) {
//         log('Screen brightness restore error:', e);
//       }
//       origBrightnessRef.current = null;
//     }
//   }, []);

//   useEffect(
//     () => () => {
//       restoreScreenBrightness();
//       if (zoomIndicatorTimeout.current)
//         clearTimeout(zoomIndicatorTimeout.current);
//     },
//     [restoreScreenBrightness],
//   );

//   // IMPROVED: Photo capture with better quality settings (kept as you wrote)
//   const takePhoto = async () => {
//     if (!camera.current) return;

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
//         flashMode === 'flash' && device?.hasFlash && cameraPosition !== 'front'
//           ? 'on'
//           : 'off';

//       log('takePhoto ->', {
//         flashParam,
//         torch: flashMode === 'torch' && cameraPosition !== 'front',
//         zoom,
//         ev,
//       });

//       const result = await camera.current.takePhoto({
//         flash: flashParam,
//         qualityPrioritization: 'balanced',
//         enableShutterSound: false,
//         enableAutoStabilization: true,
//       });

//       setPhoto(result);
//       setVideoFile(null);
//       log('Photo taken:', result);
//     } catch (e) {
//       Alert.alert('Camera Error', e?.message || String(e));
//       log('Error takePhoto:', e);
//     }
//   };

//   // Video recording (kept)
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

//       if (mode === 'video' && cameraPosition === 'front' && autoLowLightFront) {
//         if (videoFps > 24) {
//           const newFps = clamp(24, videoFpsRange.min, videoFpsRange.max);
//           setVideoFps(newFps);
//           log('Auto low-light (front): FPS -> 24 to brighten preview.');
//         }
//         try {
//           if (camera.current?.setExposureCompensation) {
//             await camera.current.setExposureCompensation(Math.max(ev, 0.7));
//             log('Auto low-light: exposure compensation bumped.');
//           }
//         } catch {}
//       }

//       if (cameraPosition === 'front' && (selfieLight || lowLightPreset)) {
//         const target = Math.max(selfieIntensity, 0.85);
//         if (ScreenBrightness) {
//           try {
//             const cur = await ScreenBrightness.getBrightness();
//             origBrightnessRef.current = cur;
//             log('Current screen brightness:', cur, ' -> setting to', target);
//             await ScreenBrightness.setBrightness(target);
//           } catch (e) {
//             log('ScreenBrightness error:', e);
//           }
//         } else {
//           log('ScreenBrightness module missing, using edge light bars only.');
//         }
//       }

//       camera.current.startRecording({
//         onRecordingFinished: video => {
//           log('Recording finished:', video);
//           clearInterval(recordTimerRef.current);
//           setIsRecording(false);
//           setVideoFile(video);
//           setPhoto(null);
//           restoreScreenBrightness();
//         },
//         onRecordingError: error => {
//           log('Recording error:', error);
//           clearInterval(recordTimerRef.current);
//           setIsRecording(false);
//           restoreScreenBrightness();
//           Alert.alert('Record Error', error?.message || String(error));
//         },
//         fileType: 'mp4',
//       });
//     } catch (e) {
//       log('startRecording exception:', e);
//       setIsRecording(false);
//       restoreScreenBrightness();
//     }
//   };

//   const stopRecording = async () => {
//     if (!camera.current) return;
//     try {
//       log('stopRecording...');
//       await camera.current.stopRecording();
//     } catch (e) {
//       log('stopRecording error:', e);
//       restoreScreenBrightness();
//     }
//   };

//   const saveCurrent = async () => {
//     if (photo?.path) return savePhoto();
//     if (videoFile?.path) return saveVideo();
//   };

//   const savePhoto = async () => {
//     if (!photo?.path) return;
//     setIsSaving(true);
//     try {
//       const signatureData = await fetch(
//         'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//       ).then(res => res.json());
//       log('Got ImageKit signature:', signatureData);

//       const fileName = photo.path.split('/').pop() || `photo_${Date.now()}.jpg`;
//       const wrappedPath = BlobUtil.wrap(photo.path.replace(/^file:\/\//, ''));

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
//     if (!videoFile?.path) return;
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
//         videoFile.path.replace(/^file:\/\//, ''),
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

//   const torchValue =
//     cameraPosition === 'front'
//       ? 'off'
//       : flashMode === 'torch' && device?.hasFlash
//       ? 'on'
//       : 'off';

//   const camHeight = getCameraHeight();

//   const minZ = typeof device.minZoom === 'number' ? device.minZoom : 1;
//   const maxZ = typeof device.maxZoom === 'number' ? device.maxZoom : 4;

//   const previewBoxHeight = camHeight;
//   const isFull = aspectKey === 'full';

//   const edgeLightOpacity =
//     cameraPosition === 'front' && isRecording && (selfieLight || lowLightPreset)
//       ? selfieIntensity
//       : 0;

//   const currentFormat = mode === 'video' ? bestVideoFormat : bestPhotoFormat;
//   const fpsToUse =
//     mode === 'video'
//       ? clamp(videoFps, videoFpsRange.min, videoFpsRange.max)
//       : undefined;

//   const videoHdr = cameraPosition === 'front' ? false : false;
//   const videoStabilizationMode =
//     cameraPosition === 'front' ? 'off' : 'standard';

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
//               {/* Pinch responder overlay — FIX: allow this overlay to receive touches */}
//               <View
//                 style={StyleSheet.absoluteFill}
//                 onStartShouldSetResponder={onStartShouldSetResponder}
//                 onMoveShouldSetResponder={onMoveShouldSetResponder}
//                 onResponderGrant={onResponderGrant}
//                 onResponderMove={onResponderMove}
//                 onResponderRelease={onResponderRelease}
//               />

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
//                   enableZoomGesture // okay to keep; our overlay handles multi-touch
//                   zoom={zoom}
//                   onInitialized={() => log('Camera initialized')}
//                   onError={e => log('Camera onError:', e)}
//                   format={currentFormat || undefined}
//                   fps={fpsToUse}
//                   whiteBalance="auto"
//                   videoHdr={videoHdr}
//                   videoStabilizationMode={videoStabilizationMode}
//                 />

//                 {/* Edge light bars */}
//                 {edgeLightOpacity > 0 && (
//                   <>
//                     <View
//                       style={[
//                         styles.lightBarH,
//                         { top: 0, opacity: edgeLightOpacity },
//                       ]}
//                     />
//                     <View
//                       style={[
//                         styles.lightBarH,
//                         { bottom: 0, opacity: edgeLightOpacity, height: 120 },
//                       ]}
//                     />
//                     <View
//                       style={[
//                         styles.lightBarV,
//                         { left: 0, opacity: edgeLightOpacity },
//                       ]}
//                     />
//                     <View
//                       style={[
//                         styles.lightBarV,
//                         { right: 0, opacity: edgeLightOpacity },
//                       ]}
//                     />
//                   </>
//                 )}

//                 {/* Grid overlay */}
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
//                     {/* Exposure adjustment near focus point */}
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
//                           minimumTrackTintColor="#FFD700"
//                           maximumTrackTintColor="rgba(255,255,255,0.3)"
//                           thumbTintColor="#FFD700"
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

//               {/* Clean zoom indicator (shows only when zooming) */}
//               <Animated.View
//                 style={[
//                   styles.zoomIndicator,
//                   { opacity: zoomIndicatorOpacity },
//                 ]}
//                 pointerEvents="none"
//               >
//                 <Text style={styles.zoomText}>{zoom.toFixed(1)}x</Text>
//               </Animated.View>
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

//         {/* Top overlay with modern design */}
//         <Animated.View
//           pointerEvents="box-none"
//           style={[
//             styles.topOverlay,
//             { paddingTop: insets.top + 10, opacity: fadeAnim },
//           ]}
//         >
//           {!photo && !videoFile && (
//             <>
//               {/* Top Controls Row */}
//               <View style={styles.topControlsRow}>
//                 {/* Flash Control */}
//                 {device?.hasFlash && cameraPosition !== 'front' && (
//                   <TouchableOpacity
//                     onPress={cycleFlash}
//                     style={styles.topControlBtn}
//                   >
//                     {flashMode === 'off' && (
//                       <Icon name="flash-off" size={24} color="#fff" />
//                     )}
//                     {flashMode === 'flash' && (
//                       <Icon name="flash" size={24} color="#FFD700" />
//                     )}
//                     {flashMode === 'torch' && (
//                       <Icon name="flashlight" size={24} color="#FFD700" />
//                     )}
//                   </TouchableOpacity>
//                 )}

//                 {/* Center Controls */}
//                 <View style={styles.topCenterControls}>
//                   {/* Aspect Ratio */}
//                   <TouchableOpacity
//                     onPress={() => {
//                       const idx = ASPECTS.findIndex(a => a.key === aspectKey);
//                       const nextIdx = (idx + 1) % ASPECTS.length;
//                       setAspectKey(ASPECTS[nextIdx].key);
//                     }}
//                     style={styles.topControlBtn}
//                   >
//                     <Text style={styles.aspectText}>
//                       {ASPECTS.find(a => a.key === aspectKey)?.label}
//                     </Text>
//                   </TouchableOpacity>

//                   {/* Timer */}
//                   <TouchableOpacity
//                     onPress={() => {
//                       const idx = TIMERS.indexOf(timer);
//                       const nextIdx = (idx + 1) % TIMERS.length;
//                       setTimer(TIMERS[nextIdx]);
//                     }}
//                     style={styles.topControlBtn}
//                   >
//                     <Icon
//                       name="timer-outline"
//                       size={24}
//                       color={timer > 0 ? '#FFD700' : '#fff'}
//                     />
//                     {timer > 0 && (
//                       <Text style={styles.timerBadge}>{timer}s</Text>
//                     )}
//                   </TouchableOpacity>

//                   {/* Grid */}
//                   <TouchableOpacity
//                     onPress={() => setShowGrid(!showGrid)}
//                     style={styles.topControlBtn}
//                   >
//                     <Icon
//                       name="grid-outline"
//                       size={24}
//                       color={showGrid ? '#FFD700' : '#fff'}
//                     />
//                   </TouchableOpacity>
//                 </View>

//                 {/* Settings */}
//                 <TouchableOpacity
//                   onPress={() => setShowSettings(!showSettings)}
//                   style={styles.topControlBtn}
//                 >
//                   <Icon name="settings-outline" size={24} color="#fff" />
//                 </TouchableOpacity>
//               </View>

//               {/* Settings Panel (kept) */}
//               {showSettings && (
//                 <Animated.View
//                   style={[
//                     styles.settingsPanel,
//                     {
//                       opacity: fadeAnim,
//                       transform: [{ translateY: slideAnim }],
//                     },
//                   ]}
//                 >
//                   <LinearGradient
//                     colors={['rgba(0,0,0,0.9)', 'rgba(0,0,0,0.7)']}
//                     style={styles.settingsPanelGradient}
//                   >
//                     {/* Exposure Slider */}
//                     <View style={styles.settingRow}>
//                       <Icon name="sunny-outline" size={20} color="#fff" />
//                       <Slider
//                         style={styles.settingSlider}
//                         value={ev}
//                         minimumValue={-2}
//                         maximumValue={2}
//                         step={0.1}
//                         minimumTrackTintColor="#FFD700"
//                         maximumTrackTintColor="rgba(255,255,255,0.3)"
//                         thumbTintColor="#FFD700"
//                         onValueChange={v => applyExposure(v)}
//                       />
//                       <Text style={styles.settingValue}>{ev.toFixed(1)}</Text>
//                     </View>

//                     {/* Video FPS */}
//                     {mode === 'video' && (
//                       <View style={styles.settingRow}>
//                         <Text style={styles.settingLabel}>FPS</Text>
//                         <View style={styles.fpsButtons}>
//                           {FPS_CHOICES.map(f => {
//                             const supported =
//                               f >= videoFpsRange.min && f <= videoFpsRange.max;
//                             return (
//                               <TouchableOpacity
//                                 key={f}
//                                 disabled={!supported}
//                                 onPress={() =>
//                                   setVideoFps(
//                                     clamp(
//                                       f,
//                                       videoFpsRange.min,
//                                       videoFpsRange.max,
//                                     ),
//                                   )
//                                 }
//                                 style={[
//                                   styles.fpsBtn,
//                                   videoFps === f && styles.fpsBtnActive,
//                                   !supported && { opacity: 0.3 },
//                                 ]}
//                               >
//                                 <Text
//                                   style={[
//                                     styles.fpsBtnText,
//                                     videoFps === f && styles.fpsBtnTextActive,
//                                   ]}
//                                 >
//                                   {f}
//                                 </Text>
//                               </TouchableOpacity>
//                             );
//                           })}
//                         </View>
//                       </View>
//                     )}

//                     {/* Selfie Light (front camera + video) */}
//                     {cameraPosition === 'front' && mode === 'video' && (
//                       <>
//                         <View style={styles.settingRow}>
//                           <TouchableOpacity
//                             onPress={() => setSelfieLight(!selfieLight)}
//                             style={styles.settingToggle}
//                           >
//                             <Icon
//                               name="bulb-outline"
//                               size={20}
//                               color={selfieLight ? '#FFD700' : '#fff'}
//                             />
//                             <Text style={styles.settingLabel}>
//                               Selfie Light
//                             </Text>
//                           </TouchableOpacity>
//                         </View>

//                         {selfieLight && (
//                           <View style={styles.settingRow}>
//                             <Text style={styles.settingLabel}>Intensity</Text>
//                             <Slider
//                               style={styles.settingSlider}
//                               value={selfieIntensity}
//                               minimumValue={0}
//                               maximumValue={1}
//                               step={0.05}
//                               minimumTrackTintColor="#FFD700"
//                               maximumTrackTintColor="rgba(255,255,255,0.3)"
//                               thumbTintColor="#FFD700"
//                               onValueChange={v => setSelfieIntensity(v)}
//                             />
//                             <Text style={styles.settingValue}>
//                               {Math.round(selfieIntensity * 100)}%
//                             </Text>
//                           </View>
//                         )}
//                       </>
//                     )}
//                   </LinearGradient>
//                 </Animated.View>
//               )}
//             </>
//           )}
//         </Animated.View>

//         {/* Bottom overlay with cleaner design */}
//         <Animated.View
//           pointerEvents="box-none"
//           style={[
//             styles.bottomOverlay,
//             { paddingBottom: insets.bottom + 20, opacity: fadeAnim },
//           ]}
//         >
//           {!photo && !videoFile ? (
//             <>
//               {/* Mode selector */}
//               <View style={styles.modeSelector}>
//                 <TouchableOpacity
//                   onPress={() => setMode('photo')}
//                   style={[
//                     styles.modeOption,
//                     mode === 'photo' && styles.modeOptionActive,
//                   ]}
//                 >
//                   <Text
//                     style={[
//                       styles.modeText,
//                       mode === 'photo' && styles.modeTextActive,
//                     ]}
//                   >
//                     PHOTO
//                   </Text>
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={() => setMode('video')}
//                   style={[
//                     styles.modeOption,
//                     mode === 'video' && styles.modeOptionActive,
//                   ]}
//                 >
//                   <Text
//                     style={[
//                       styles.modeText,
//                       mode === 'video' && styles.modeTextActive,
//                     ]}
//                   >
//                     VIDEO
//                   </Text>
//                 </TouchableOpacity>
//               </View>

//               {/* Main controls */}
//               <View style={styles.mainControls}>
//                 {/* Gallery Button */}
//                 <TouchableOpacity
//                   onPress={() => navigation.navigate('Gallery')}
//                   style={styles.galleryBtn}
//                 >
//                   <Icon name="images-outline" size={28} color="#fff" />
//                 </TouchableOpacity>

//                 {/* Shutter Button */}
//                 {mode === 'photo' ? (
//                   <TouchableOpacity
//                     onPress={takePhoto}
//                     activeOpacity={0.7}
//                     style={styles.shutterContainer}
//                   >
//                     <LinearGradient
//                       colors={[shutterColor, shutterColor + 'DD']}
//                       style={styles.shutterButton}
//                     >
//                       <View style={styles.shutterInner} />
//                     </LinearGradient>
//                   </TouchableOpacity>
//                 ) : (
//                   <TouchableOpacity
//                     onPress={isRecording ? stopRecording : startRecording}
//                     activeOpacity={0.7}
//                     style={styles.shutterContainer}
//                   >
//                     <LinearGradient
//                       colors={
//                         isRecording
//                           ? ['#FF3D00', '#D32F2F']
//                           : ['#FF5252', '#FF3D00']
//                       }
//                       style={styles.shutterButton}
//                     >
//                       <View
//                         style={[
//                           styles.shutterInner,
//                           isRecording && styles.recordingInner,
//                         ]}
//                       />
//                     </LinearGradient>
//                   </TouchableOpacity>
//                 )}

//                 {/* Camera Switch */}
//                 <TouchableOpacity
//                   onPress={switchCamera}
//                   style={styles.switchBtn}
//                 >
//                   <Icon name="camera-reverse-outline" size={28} color="#fff" />
//                 </TouchableOpacity>
//               </View>

//               {/* Recording indicator */}
//               {isRecording && (
//                 <View style={styles.recordingIndicator}>
//                   <View style={styles.recordingDot} />
//                   <Text style={styles.recordingTime}>
//                     {Math.floor(recordSecs / 60)}:
//                     {String(recordSecs % 60).padStart(2, '0')}
//                   </Text>
//                 </View>
//               )}

//               {/* Countdown */}
//               {countdown > 0 && (
//                 <View style={styles.countdownContainer}>
//                   <Text style={styles.countdownText}>{countdown}</Text>
//                 </View>
//               )}
//             </>
//           ) : (
//             /* Preview Actions */
//             <View style={styles.previewActions}>
//               <TouchableOpacity onPress={retake} style={styles.previewBtn}>
//                 <Icon name="close-circle-outline" size={32} color="#fff" />
//                 <Text style={styles.previewBtnText}>Retake</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 onPress={saveCurrent}
//                 disabled={isSaving}
//                 style={[styles.previewBtn, styles.saveBtn]}
//               >
//                 <LinearGradient
//                   colors={[shutterColor, shutterColor + 'DD']}
//                   style={styles.saveBtnGradient}
//                 >
//                   <Icon name="checkmark-circle" size={32} color="#fff" />
//                 </LinearGradient>
//                 <Text style={styles.previewBtnText}>
//                   {isSaving ? 'Saving...' : 'Save'}
//                 </Text>
//               </TouchableOpacity>
//             </View>
//           )}
//         </Animated.View>

//         {isSaving && (
//           <View style={styles.savingOverlay}>
//             <ActivityIndicator color="#fff" />
//             <Text style={{ color: '#fff', marginTop: 8 }}>Uploading...</Text>
//           </View>
//         )}
//       </View>
//     </SafeAreaView>
//   );
// };

// // Modern, clean styles
// const styles = StyleSheet.create({
//   loader: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#000',
//     paddingHorizontal: 16,
//   },
//   camera: { width: '100%', height: '100%' },

//   centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
//   previewContainer: { width: '100%', backgroundColor: '#000' },

//   // Top overlay
//   topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
//   topControlsRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//     paddingHorizontal: 20,
//     paddingVertical: 10,
//   },
//   topControlBtn: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     backgroundColor: 'rgba(0,0,0,0.4)',
//     alignItems: 'center',
//     justifyContent: 'center',
//     position: 'relative',
//   },
//   topCenterControls: { flexDirection: 'row', gap: 12 },
//   aspectText: { color: '#fff', fontSize: 12, fontWeight: '600' },
//   timerBadge: {
//     position: 'absolute',
//     top: -2,
//     right: -2,
//     backgroundColor: '#FFD700',
//     borderRadius: 8,
//     paddingHorizontal: 4,
//     paddingVertical: 1,
//     fontSize: 10,
//     fontWeight: 'bold',
//     color: '#000',
//   },

//   settingsPanel: {
//     position: 'absolute',
//     top: 70,
//     left: 20,
//     right: 20,
//     borderRadius: 16,
//     overflow: 'hidden',
//   },
//   settingsPanelGradient: { padding: 16, borderRadius: 16 },
//   settingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
//   settingLabel: { color: '#fff', fontSize: 14, marginLeft: 8, minWidth: 50 },
//   settingSlider: { flex: 1, height: 40, marginHorizontal: 12 },
//   settingValue: {
//     color: '#fff',
//     fontSize: 12,
//     minWidth: 40,
//     textAlign: 'right',
//   },
//   settingToggle: { flexDirection: 'row', alignItems: 'center' },
//   fpsButtons: {
//     flexDirection: 'row',
//     flex: 1,
//     justifyContent: 'flex-end',
//     gap: 8,
//   },
//   fpsBtn: {
//     paddingHorizontal: 12,
//     paddingVertical: 6,
//     borderRadius: 12,
//     backgroundColor: 'rgba(255,255,255,0.1)',
//   },
//   fpsBtnActive: { backgroundColor: 'rgba(255,215,0,0.3)' },
//   fpsBtnText: { color: '#fff', fontSize: 12 },
//   fpsBtnTextActive: { color: '#FFD700', fontWeight: 'bold' },

//   bottomOverlay: {
//     position: 'absolute',
//     left: 0,
//     right: 0,
//     bottom: 0,
//     alignItems: 'center',
//   },
//   modeSelector: {
//     flexDirection: 'row',
//     backgroundColor: 'rgba(0,0,0,0.4)',
//     borderRadius: 20,
//     padding: 4,
//     marginBottom: 20,
//   },
//   modeOption: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16 },
//   modeOptionActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
//   modeText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
//   modeTextActive: { color: '#fff' },

//   mainControls: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//     width: '85%',
//     paddingHorizontal: 10,
//   },
//   galleryBtn: {
//     width: 50,
//     height: 50,
//     borderRadius: 25,
//     backgroundColor: 'rgba(0,0,0,0.4)',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   shutterContainer: { padding: 4 },
//   shutterButton: {
//     width: 72,
//     height: 72,
//     borderRadius: 36,
//     padding: 3,
//     alignItems: 'center',
//     justifyContent: 'center',
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//   },
//   shutterInner: {
//     width: 62,
//     height: 62,
//     borderRadius: 31,
//     backgroundColor: '#fff',
//   },
//   recordingInner: {
//     borderRadius: 8,
//     backgroundColor: '#fff',
//     width: 32,
//     height: 32,
//   },
//   switchBtn: {
//     width: 50,
//     height: 50,
//     borderRadius: 25,
//     backgroundColor: 'rgba(0,0,0,0.4)',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },

//   recordingIndicator: {
//     position: 'absolute',
//     top: -60,
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: 'rgba(0,0,0,0.6)',
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 20,
//   },
//   recordingDot: {
//     width: 8,
//     height: 8,
//     borderRadius: 4,
//     backgroundColor: '#FF3D00',
//     marginRight: 8,
//   },
//   recordingTime: { color: '#fff', fontSize: 16, fontWeight: '600' },

//   countdownContainer: {
//     position: 'absolute',
//     top: -100,
//     width: 80,
//     height: 80,
//     borderRadius: 40,
//     backgroundColor: 'rgba(0,0,0,0.7)',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   countdownText: { color: '#fff', fontSize: 36, fontWeight: 'bold' },

//   previewActions: {
//     flexDirection: 'row',
//     justifyContent: 'space-around',
//     width: '70%',
//     alignItems: 'center',
//   },
//   previewBtn: { alignItems: 'center' },
//   previewBtnText: {
//     color: '#fff',
//     marginTop: 8,
//     fontSize: 14,
//     fontWeight: '600',
//   },
//   saveBtn: { transform: [{ scale: 1.2 }] },
//   saveBtnGradient: {
//     width: 64,
//     height: 64,
//     borderRadius: 32,
//     alignItems: 'center',
//     justifyContent: 'center',
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
//     borderColor: '#FFD700',
//     backgroundColor: 'transparent',
//   },

//   // Zoom indicator
//   zoomIndicator: {
//     position: 'absolute',
//     top: 20,
//     alignSelf: 'center',
//     backgroundColor: 'rgba(0,0,0,0.6)',
//     paddingHorizontal: 12,
//     paddingVertical: 4,
//     borderRadius: 12,
//   },
//   zoomText: { color: '#fff', fontSize: 12, fontWeight: '600' },

//   // Edge light bars
//   lightBarH: {
//     position: 'absolute',
//     left: 0,
//     right: 0,
//     height: 80,
//     backgroundColor: '#fff',
//   },
//   lightBarV: {
//     position: 'absolute',
//     top: 0,
//     bottom: 0,
//     width: 24,
//     backgroundColor: '#fff',
//   },

//   // Temporary EV control near focus point
//   tempEVWrap: { position: 'absolute', width: 44, alignItems: 'center' },
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

//   smallBtn: {
//     marginTop: 16,
//     borderWidth: 1,
//     borderRadius: 10,
//     paddingVertical: 8,
//     paddingHorizontal: 12,
//   },
// });

// export default CameraScreen;
