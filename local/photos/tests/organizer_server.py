"""Isolated UI fixture server; fake model stays confined to tests."""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import Library, Server
from organizer import Organizer
from test_photos import fixture
from test_organizer import FakeEngine
from organizer import image_signature

parser = argparse.ArgumentParser(); parser.add_argument('root', type=Path); parser.add_argument('--grouped', action='store_true'); args = parser.parse_args()
folder = args.root / 'Photos'; fixture(folder)
library = Library(args.root / 'state', {'kind': 'folder', 'path': str(folder)}); library.scan()
library.organizer = Organizer(library, FakeEngine(), lambda path: '商品详情\n加入购物车\n测试品牌蓝色背包')
library.organizer.run()
photos = library.raw_photos()[:2]
library.content_reviews.save([{'id': photo['id'], 'source': library.source_key, 'signature': image_signature(photo),
    'label': f'SCR{index+1:03d}', 'description': '测试品牌蓝色背包的商品详情截图，页面完整展示肩带、侧袋、拉链、商品规格、尺寸选择、价格信息及购买入口，描述应当全部显示而不是以省略号截断。', 'recommendation': 'candidate',
    'reason': '可能为临时购物参考', 'caution': '购买用途尚需用户确认', 'tags': ['背包', '购物参考']} for index,photo in enumerate(photos)])
if args.grouped:
    photos = library.raw_photos()
    cases = [
        ('candidate', 'product', 'A', '背包商品页面'),
        ('uncertain', 'product', 'A', '购物车价格对比'),
        ('candidate', 'interface', 'C', '加湿器控制页面'),
        ('uncertain', 'credential', 'H', '信用卡交易账单'),
        ('candidate', 'interface', 'C', '已经手动保留的设置截图'),
        ('uncertain', 'other', 'N', '内容待确认的普通图片'),
        ('keep', 'people', 'O', '户外人物合影'),
    ]
    library.content_reviews.save([
        {'id': photo['id'], 'source': library.source_key, 'signature': image_signature(photo),
         'label': f'SCR{index+1:03d}', 'description': caption + '，这是一段需要完整显示的客观说明，包含画面主体、界面布局与能够看清的细节。',
         'short_description': caption, 'cleanup_group': group, 'category': category,
         'recommendation': recommendation, 'reason': '测试用户复核流程', 'caution': '',
         'tags': ['页面', '内容', '测试'], 'review_standard': 'grounded-v2',
         'inspection': {'full_image': True, 'zoomed': False, 'unclear_fields': []}}
        for index, (photo, (recommendation, category, group, caption)) in enumerate(zip(photos, cases))])
    library.annotation(photos[4]['id'], {'review': 'keep'})
def test_trash(request):
    import json
    assert request['action'] == 'trash-batch'
    trash = args.root / 'Trash'; trash.mkdir(exist_ok=True)
    deleted=[]
    for item in request['items']:
        path=Path(item['path']).resolve(); assert path.is_relative_to(folder.resolve())
        path.rename(trash/path.name);deleted.append(item['id'])
    (args.root/'native-calls.json').write_text(json.dumps({'calls':1,'items':len(deleted)}))
    return {'deleted_ids':deleted,'destination':'trash','failed':[]}
library.deletion.native = test_trash
server = Server(('127.0.0.1', 0), library, map_config={})
print(f'Test Organizer: {server.origin}', flush=True)
server.serve_forever()
