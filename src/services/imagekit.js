// src/services/imagekit.js
import { Platform } from 'react-native';

// These values should be generated on your backend for production use!
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';
const IMAGEKIT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';

// For demo/testing, you can hardcode these, but for production, fetch from your backend!
export async function uploadToImageKit({
  uri,
  fileName,
  signature,
  expire,
  token,
}) {
  const formData = new FormData();
  formData.append('file', {
    uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
    type: 'image/jpeg',
    name: fileName,
  });
  formData.append('fileName', fileName);
  formData.append('publicKey', IMAGEKIT_PUBLIC_KEY);
  formData.append('signature', signature);
  formData.append('expire', expire);
  formData.append('token', token);

  const response = await fetch(IMAGEKIT_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'ImageKit upload failed');
  return data.url; // This is the CDN URL of the uploaded image
}
