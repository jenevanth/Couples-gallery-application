import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/Ionicons';

const ErrorModal = ({
  visible,
  message = '',
  onClose,
  theme,
  type = 'info', // 'info' | 'error' | 'success'
  title, // optional custom title
  actionLabel = 'OK', // optional custom button text
  autoDismissMs, // optional number: auto-close after X ms
  dismissOnBackdrop = true, // allow backdrop tap to close
  testID = 'error-modal',
}) => {
  const primary = theme?.colors?.primary || '#667EEA';

  const iconProps = {
    info: { name: 'information-circle', color: primary },
    error: { name: 'alert-circle', color: '#FF6347' },
    success: { name: 'checkmark-circle', color: '#22C55E' }, // green for success
  }[type] || { name: 'information-circle', color: primary };

  useEffect(() => {
    if (!visible || !autoDismissMs) return;
    const t = setTimeout(() => onClose?.(), autoDismissMs);
    return () => clearTimeout(t);
  }, [visible, autoDismissMs, onClose]);

  return (
    <Modal
      isVisible={!!visible}
      onBackdropPress={dismissOnBackdrop ? onClose : undefined}
      onBackButtonPress={onClose}
      animationIn="zoomIn"
      animationOut="zoomOut"
      backdropOpacity={0.25}
      useNativeDriver
      hideModalContentWhileAnimating
      testID={testID}
      accessibilityViewIsModal
      accessibilityLabel="Status dialog"
    >
      <View
        style={[
          styles.modal,
          {
            backgroundColor: '#fff',
            borderColor: `${primary}33`,
            shadowColor: primary,
          },
        ]}
      >
        <Icon
          name={iconProps.name}
          size={38}
          color={iconProps.color}
          style={{ marginBottom: 8 }}
        />
        <Text style={[styles.title, { color: primary }]}>
          {title
            ? title
            : type === 'error'
            ? 'Oops!'
            : type === 'success'
            ? 'Success!'
            : 'Info'}
        </Text>

        <ScrollView
          style={{ maxHeight: 160, alignSelf: 'stretch' }}
          contentContainerStyle={{ alignItems: 'center' }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.message}>
            {typeof message === 'string' ? message : String(message)}
          </Text>
        </ScrollView>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: primary }]}
          onPress={onClose}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Close dialog"
        >
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modal: {
    padding: 22,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    minWidth: 240,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  message: {
    fontSize: 16,
    marginBottom: 18,
    textAlign: 'center',
    color: '#222',
    lineHeight: 22,
    paddingHorizontal: 4,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 36,
    borderRadius: 22,
    marginTop: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: Platform.OS === 'android' ? 2 : 0,
  },
});

export default ErrorModal;

// import React from 'react';
// import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
// import Modal from 'react-native-modal';
// import Icon from 'react-native-vector-icons/Ionicons';

// const ErrorModal = ({ visible, message, onClose, theme, type = 'info' }) => {
//   // type: 'info' | 'error' | 'success'
//   const iconProps = {
//     info: { name: 'information-circle', color: theme.colors.primary },
//     error: { name: 'alert-circle', color: '#FF6347' },
//     success: { name: 'checkmark-circle', color: '#4FC3F7' },
//   }[type] || { name: 'information-circle', color: theme.colors.primary };

//   return (
//     <Modal
//       isVisible={visible}
//       onBackdropPress={onClose}
//       animationIn="zoomIn"
//       animationOut="zoomOut"
//       backdropOpacity={0.25}
//       useNativeDriver
//     >
//       <View
//         style={[
//           styles.modal,
//           {
//             backgroundColor: '#fff',
//             borderColor: theme.colors.primary + '33',
//             shadowColor: theme.colors.primary,
//           },
//         ]}
//       >
//         <Icon
//           name={iconProps.name}
//           size={38}
//           color={iconProps.color}
//           style={{ marginBottom: 8 }}
//         />
//         <Text style={[styles.title, { color: theme.colors.primary }]}>
//           {type === 'error'
//             ? 'Oops!'
//             : type === 'success'
//             ? 'Success!'
//             : 'Info'}
//         </Text>
//         <Text style={styles.message}>{message}</Text>
//         <TouchableOpacity
//           style={[styles.button, { backgroundColor: theme.colors.primary }]}
//           onPress={onClose}
//           activeOpacity={0.85}
//         >
//           <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
//             OK
//           </Text>
//         </TouchableOpacity>
//       </View>
//     </Modal>
//   );
// };

// const styles = StyleSheet.create({
//   modal: {
//     padding: 22,
//     borderRadius: 18,
//     alignItems: 'center',
//     borderWidth: 1.5,
//     minWidth: 240,
//     shadowOpacity: 0.18,
//     shadowRadius: 12,
//     shadowOffset: { width: 0, height: 4 },
//     elevation: 8,
//   },
//   title: {
//     fontSize: 20,
//     fontWeight: 'bold',
//     marginBottom: 8,
//     letterSpacing: 0.5,
//   },
//   message: {
//     fontSize: 16,
//     marginBottom: 18,
//     textAlign: 'center',
//     color: '#222',
//     lineHeight: 22,
//   },
//   button: {
//     paddingVertical: 10,
//     paddingHorizontal: 36,
//     borderRadius: 22,
//     marginTop: 2,
//     shadowColor: '#000',
//     shadowOpacity: 0.08,
//     shadowRadius: 4,
//     shadowOffset: { width: 0, height: 2 },
//     elevation: 2,
//   },
// });

// export default ErrorModal;
