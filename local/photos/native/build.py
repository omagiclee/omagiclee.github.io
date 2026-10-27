"""Build a local, identifiable PhotoKit helper; no photo changes are performed."""
import plistlib
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[3]
app = root / '.local-photos/native/LocalPhotos.app'
contents = app / 'Contents'
binary = contents / 'MacOS/PhotoBridge'
binary.parent.mkdir(parents=True, exist_ok=True)
info = {'CFBundleIdentifier': 'io.omagiclee.localphotos.bridge', 'CFBundleName': '本地相册',
        'CFBundleDisplayName': '本地相册', 'CFBundleExecutable': 'PhotoBridge', 'CFBundlePackageType': 'APPL',
        'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0', 'LSUIElement': True,
        'NSPhotoLibraryUsageDescription': '删除你在本地相册中点击的照片。照片会移到最近删除，并通过 iCloud 同步到你的设备。'}
(contents / 'Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['xcrun','swiftc',str(Path(__file__).with_name('PhotoBridge.swift')),'-o',str(binary),
                '-module-cache-path',str(root / '.local-photos/native/module-cache'),'-framework','AppKit','-framework','Photos'],check=True)
subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(app)],check=True)
print('本地照片删除组件已构建。')
