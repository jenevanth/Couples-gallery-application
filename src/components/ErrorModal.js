import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Modal from 'react-native-modal';

const ErrorModal = ({ visible, message, onClose, theme }) => (
  <Modal isVisible={visible} onBackdropPress={onClose}>
    <View style={[styles.modal, { backgroundColor: theme.colors.light }]}>
      <Text style={[styles.title, { color: theme.colors.primary }]}>
        Report
      </Text>
      <Text style={styles.message}>{message}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: theme.colors.primary }]}
        onPress={onClose}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold' }}>OK</Text>
      </TouchableOpacity>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  modal: { padding: 24, borderRadius: 16, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  message: { fontSize: 16, marginBottom: 20, textAlign: 'center' },
  button: { paddingVertical: 10, paddingHorizontal: 32, borderRadius: 8 },
});

export default ErrorModal;
