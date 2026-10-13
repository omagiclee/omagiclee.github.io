"""Independent media-type and content-theme axes; suggestions require review."""
TYPES = {'screenshot': '截图', 'photo': '实拍照片', 'artwork': '图片素材', 'unknown': '类型待确认'}
CATEGORIES = {
    'invoice': ('发票／票据', 'an invoice, tax invoice or receipt document with a table of prices'),
    'product': ('商品／电商', 'a retail product, shopping page, ecommerce product listing with price and purchase buttons'),
    'order': ('订单／支付', 'a payment receipt, order confirmation or banking transaction screenshot'),
    'credential': ('证件／凭证', 'an identity card, certificate, boarding pass, travel ticket or admission ticket'),
    'chat': ('聊天／社交', 'a messaging app conversation, chat screenshot or social media feed'),
    'document': ('文章／资料', 'a document, article, notes, spreadsheet or presentation slide with text'),
    'interface': ('软件界面', 'a screenshot of a software interface, phone application or computer settings'),
    'people': ('人物／合影', 'a photo of people, family, a portrait or a group of friends'),
    'scenery': ('风景／旅行', 'a landscape, tourist attraction, beach, mountains, city scenery or travel photo'),
    'food': ('美食／餐饮', 'a photo of food, a meal, restaurant dishes or drinks'),
    'animal': ('宠物／动物', 'a photo of a pet, cat, dog, bird or another animal'),
    'interior': ('建筑／室内', 'a photo of a building, architecture, furniture or an indoor room'),
    'artwork': ('海报／插画', 'a digital illustration, poster, wallpaper, graphic design or artwork'),
    'meme': ('表情／趣图', 'a meme, cartoon sticker or funny reaction image'),
    'other': ('其他／待确认', 'an image with unclear content'),
}
TYPE_PROMPTS = [
    ('screenshot', 'a screenshot captured from a phone screen or computer display'),
    ('photo', 'a photograph taken with a camera of the real world'),
    ('artwork', 'a digitally created graphic, illustration or image design'),
]
OCR_THEMES = {'invoice', 'product', 'order', 'credential', 'chat', 'document', 'interface'}
TEXT_RULES = [
    ('invoice', ('发票', '税率', '价税合计', '纳税人识别号', '发票号码', '购买方', '销售方', 'invoice'), 2),
    ('credential', ('身份证', '登机牌', '准考证', '护照', 'boarding pass', 'passport'), 1),
    ('order', ('订单编号', '支付成功', '交易成功', '交易单号', '实付款', 'order number'), 1),
    ('product', ('加入购物车', '立即购买', '商品详情', '领券', '销量', '规格', 'add to cart'), 1),
    ('chat', ('发送消息', '聊天记录', '群聊', '聊天'), 2),
]
REVISION = 'photo-types-and-themes-v2'


def suggestion(record, visual, text):
    category = visual.get('category', 'other')
    if category not in CATEGORIES:
        category = 'other'
    method = '视觉语义建议'
    folded = text.casefold()
    for theme, words, minimum in TEXT_RULES:
        if sum(word.casefold() in folded for word in words) >= minimum:
            category, method = theme, '本地文字识别'
            break
    media_type = 'screenshot' if record.get('screenshot') else visual.get('media_type', 'unknown')
    if media_type not in TYPES:
        media_type = 'unknown'
    uncertain = visual.get('margin', 0) < .008 and method == '视觉语义建议'
    return {'media_type': media_type, 'category': category, 'tags': [TYPES[media_type], CATEGORIES[category][0]],
            'method': method, 'needs_review': True, 'uncertain': uncertain,
            'similarity': visual.get('similarity'), 'alternatives': visual.get('alternatives', [])}
