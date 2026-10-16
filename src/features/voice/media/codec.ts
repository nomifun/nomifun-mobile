import type { AudioMetadata, MediaSpec } from '../contracts';
const signature = [78, 70, 86, 49];
export function encodePacket(metadata: AudioMetadata, payload: ArrayBuffer): ArrayBuffer {
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  if (header.length > 4096 || payload.byteLength > 512 * 1024) throw new Error('Voice packet exceeds protocol limits');
  const packet = new Uint8Array(8 + header.length + payload.byteLength); packet.set(signature);
  new DataView(packet.buffer).setUint32(4, header.length, true); packet.set(header, 8); packet.set(new Uint8Array(payload), 8 + header.length); return packet.buffer;
}
export function decodePacket(packet: ArrayBuffer): { metadata: AudioMetadata; payload: ArrayBuffer } {
  const bytes = new Uint8Array(packet); if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error('Unsupported voice media protocol');
  const length = new DataView(packet).getUint32(4, true);
  if (length > 4096 || length + 8 > bytes.length || bytes.length - 8 - length > 512 * 1024) throw new Error('Invalid voice packet size');
  const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(8, length + 8))) as AudioMetadata;
  if ([metadata.activation_epoch, metadata.output_generation, metadata.sequence, metadata.timestamp, metadata.duration_us].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid media identity');
  return { metadata, payload: packet.slice(length + 8) };
}
export function validateAudio(metadata: AudioMetadata, payload: ArrayBuffer, spec: MediaSpec): void {
  const format = metadata.format;
  if (!format || format.encoding !== 'pcm' || format.sample_format !== 'signed16_le' || format.sample_rate !== spec.format.sample_rate ||
    format.channels !== spec.format.channels || payload.byteLength > spec.max_frame_bytes || payload.byteLength % (format.channels * 2) ||
    metadata.duration_us < spec.min_frame_duration_us || metadata.duration_us > spec.max_frame_duration_us ||
    Math.abs(Math.floor(payload.byteLength / (format.channels * 2) * 1e6 / format.sample_rate) - metadata.duration_us) > 1) throw new Error('Media violates the negotiated specification');
}
