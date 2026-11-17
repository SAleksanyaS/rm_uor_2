import { deflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ -1) >>> 0;
}

export function writeZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  let directoryLength = 0;
  for (const [path, content] of files) {
    const name = Buffer.from(path);
    const bytes = Buffer.from(content);
    const compressed = deflateRawSync(bytes);
    const record = Buffer.alloc(30);
    record.writeUInt32LE(0x04034b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(8, 8);
    record.writeUInt16LE(33, 12);
    record.writeUInt32LE(crc32(bytes), 14);
    record.writeUInt32LE(compressed.length, 18);
    record.writeUInt32LE(bytes.length, 22);
    record.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    record.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    local.push(record, name, compressed);
    central.push(entry, name);
    offset += record.length + name.length + compressed.length;
    directoryLength += entry.length + name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
