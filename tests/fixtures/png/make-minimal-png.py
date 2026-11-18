import struct, zlib, sys
out = sys.argv[1]
def chunk(t, d):
    b = t + d
    return struct.pack('>I', len(d)) + b + struct.pack('>I', zlib.crc32(b))
w, h = 3, 2
px = [[(255,0,0),(0,255,0),(0,0,255)],[(255,255,0),(0,255,255),(255,0,255)]]
raw = b''.join(b'\x00' + b''.join(bytes(p) for p in row) for row in px)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
open(out, 'wb').write(png)
print(len(png), zlib.ZLIB_VERSION)
print('123456789 crc', hex(zlib.crc32(b'123456789')))
print('IEND crc', hex(zlib.crc32(b'IEND')))
c = chunk(b'tEXt', b'Source\x00Victoria and Albert Museum, London (O78207)')
print('text chunk', c.hex())
print('crc tEXt', hex(zlib.crc32(b'tEXtSoftware\x00Colourway Studio')))
