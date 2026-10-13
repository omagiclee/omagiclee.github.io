"""Isolated UI fixture server; fake model stays confined to tests."""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import Library, Server
from organizer import Organizer
from test_photos import fixture
from test_organizer import FakeEngine

parser = argparse.ArgumentParser(); parser.add_argument('root', type=Path); args = parser.parse_args()
folder = args.root / 'Photos'; fixture(folder)
library = Library(args.root / 'state', {'kind': 'folder', 'path': str(folder)}); library.scan()
library.organizer = Organizer(library, FakeEngine(), lambda path: '商品详情\n加入购物车\n测试品牌蓝色背包')
library.organizer.run()
server = Server(('127.0.0.1', 0), library, map_config={})
print(f'Test Organizer: {server.origin}', flush=True)
server.serve_forever()
