"""Pack PNG files into a Windows .ico using modern PNG-in-ICO format."""
import struct, os

BUILD = os.path.dirname(__file__)
ICONSET = os.path.join(BUILD, 'icon.iconset')

# Windows ICO sizes (16, 32, 48, 256 are standard)
WANTED = {
    'icon_16x16.png': 16,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 48,   # 64px → use as 48dp placeholder
    'icon_256x256.png': 256,
}

images = []
for fname, nominal in WANTED.items():
    path = os.path.join(ICONSET, fname)
    with open(path, 'rb') as f:
        data = f.read()
    images.append((nominal, data))

# ICO header
count = len(images)
header = struct.pack('<HHH', 0, 1, count)

# Each ICONDIRENTRY is 16 bytes; image data follows all entries
entry_size = 16
data_offset = 6 + entry_size * count

entries = b''
image_data = b''
for nominal, data in images:
    w = 0 if nominal >= 256 else nominal   # 0 means 256+ in ICO spec
    h = w
    entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(data), data_offset)
    data_offset += len(data)
    image_data += data

with open(os.path.join(BUILD, 'icon.ico'), 'wb') as f:
    f.write(header + entries + image_data)

print(f'icon.ico written ({len(header + entries + image_data)} bytes)')
