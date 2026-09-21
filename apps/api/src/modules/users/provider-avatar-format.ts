/** SOOP can serve GIF bytes from a .jpg URL with an image/jpeg header.
 * Classify the bounded raster body, not its extension or upstream MIME label.
 * GIF parsing validates container framing only; it never decompresses pixels. */
export function providerAvatarContentType(bytes: Buffer): string | null {
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return null;
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  if (!width || !height || width > 4096 || height > 4096) return null;
  let offset = 13, frames = 0;
  const skip = (length: number) => { offset += length; return offset <= bytes.length; };
  const table = (packed: number) => !(packed & 128) || skip(3 * (1 << ((packed & 7) + 1)));
  const blocks = () => {
    while (offset < bytes.length) {
      const length = bytes[offset++]!;
      if (!length) return true;
      if (!skip(length)) return false;
    }
    return false;
  };
  if (!table(bytes[10]!)) return null;
  while (offset < bytes.length) {
    const marker = bytes[offset++]!;
    if (marker === 0x3b) return frames > 0 && offset === bytes.length ? 'image/gif' : null;
    if (marker === 0x21) {
      if (offset >= bytes.length) return null;
      const label = bytes[offset++]!;
      // Graphic control, comments, application data and plain text extensions.
      if (label === 0xf9) {
        if (offset + 6 > bytes.length || bytes[offset] !== 4 || bytes[offset + 5] !== 0) return null;
        offset += 6;
      } else {
        if (label === 0xff || label === 0x01) {
          const length = label === 0xff ? 11 : 12;
          if (bytes[offset++] !== length || !skip(length)) return null;
        } else if (label !== 0xfe) return null;
        if (!blocks()) return null;
      }
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length || ++frames > 512) return null;
    const left = bytes.readUInt16LE(offset), top = bytes.readUInt16LE(offset + 2);
    const frameWidth = bytes.readUInt16LE(offset + 4), frameHeight = bytes.readUInt16LE(offset + 6);
    const packed = bytes[offset + 8]!;
    offset += 9;
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height || !table(packed)) return null;
    if (offset >= bytes.length || bytes[offset]! < 2 || bytes[offset]! > 8) return null;
    offset++;
    if (offset >= bytes.length || bytes[offset] === 0 || !blocks()) return null;
  }
  return null;
}
