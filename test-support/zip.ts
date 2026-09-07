import { crc32 } from "node:zlib";
export function zip(entries: [string, string, number?][]) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text, mode = 0o100600] of entries) {
    const path = Buffer.from(name),
      data = Buffer.from(text),
      head = Buffer.alloc(30),
      index = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(path.length, 26);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(0x0314, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt32LE(crc32(data), 16);
    index.writeUInt32LE(data.length, 20);
    index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(path.length, 28);
    index.writeUInt32LE((mode * 65536) >>> 0, 38);
    index.writeUInt32LE(offset, 42);
    local.push(head, path, data);
    central.push(index, path);
    offset += head.length + path.length + data.length;
  }
  const end = Buffer.alloc(22),
    index = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
