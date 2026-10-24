/** Compact base64 for typed arrays stored in localStorage. */

function bytesToBinary(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return binary;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBytes(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

export function decodeBytes(encoded: string): Uint8Array {
  return binaryToBytes(atob(encoded));
}

export function encodeFloat32(data: Float32Array): string {
  return encodeBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

export function decodeFloat32(encoded: string): Float32Array {
  const bytes = decodeBytes(encoded);
  if (bytes.byteLength % 4 !== 0) {
    throw new Error('Float32 payload is not aligned');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function encodeUint8(data: Uint8Array): string {
  return encodeBytes(data);
}

export function decodeUint8(encoded: string): Uint8Array {
  return decodeBytes(encoded);
}
