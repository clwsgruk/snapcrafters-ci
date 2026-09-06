import { crc32, deflateSync } from "node:zlib";
export function pngBytes() {
  const chunk = (type: string, data: Buffer) => {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length);
    bytes.write(type, 4);
    data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
    return bytes;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
