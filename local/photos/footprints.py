"""Group trustworthy on-device photo place metadata into photographed cities."""
import collections
import hashlib
import statistics


def city_info(photo):
    if not photo.get('location'):
        return None
    city = photo.get('city', '').strip()
    province = photo.get('province', '').strip()
    country = photo.get('country', '').strip()
    country_code = photo.get('country_code', '').upper()
    # Compatible with old indexes: only infer an explicit Chinese city/prefecture label.
    if not city:
        parts = [part.strip() for part in photo.get('place', '').split(',') if part.strip()]
        if parts and parts[0].endswith(('市', '自治州', '地区', '盟')):
            city = parts[0]
            province = parts[1] if len(parts) >= 3 else ''
            country = parts[-1] if len(parts) >= 2 else ''
            country_code = 'CN' if country in {'中国', '中华人民共和国'} else ''
    if not city:
        return None
    identity = '\0'.join([country_code or country, province, city])
    return {'id': 'city-' + hashlib.sha256(identity.encode()).hexdigest()[:20], 'name': city,
            'province': province, 'country': country, 'country_code': country_code}


def build_footprints(photos, year=''):
    if year and (len(year) != 4 or not year.isdigit()):
        raise ValueError('请选择有效年份。')
    years = sorted({photo['date'][:4] for photo in photos if len(photo.get('date', '')) >= 4 and photo['date'][:4].isdigit()}, reverse=True)
    selected = [photo for photo in photos if not year or photo['date'].startswith(year)]
    groups = {}
    no_gps, unknown_city = 0, 0
    for photo in selected:
        if not photo.get('location'):
            no_gps += 1
            continue
        city = city_info(photo)
        if not city:
            unknown_city += 1
            continue
        group = groups.setdefault(city['id'], {**city, 'photos': []})
        group['photos'].append(photo)
    cities = []
    for group in groups.values():
        items = sorted(group.pop('photos'), key=lambda photo: (photo['date'], photo['id']))
        dates = sorted({photo['date'][:10] for photo in items if photo['date']})
        lat = statistics.median(photo['location']['lat'] for photo in items)
        anchor = items[0]['location']['lon']
        lon = statistics.median(anchor + ((photo['location']['lon'] - anchor + 180) % 360 - 180) for photo in items)
        lon = (lon + 180) % 360 - 180
        previews = [photo for photo in items if photo['has_preview']]
        cover = next((photo for photo in previews if photo['favorite']), previews[-1] if previews else None)
        cities.append({**group, 'photo_count': len(items), 'days': len(dates), 'first_date': dates[0] if dates else '',
                       'last_date': dates[-1] if dates else '', 'years': sorted({date[:4] for date in dates}),
                       'center': {'lat': lat, 'lon': lon}, 'cover': cover['id'] if cover else None,
                       'photo_ids': [photo['id'] for photo in items]})
    cities.sort(key=lambda city: (city['last_date'], city['photo_count']), reverse=True)
    return {'cities': cities, 'years': years, 'year': year, 'stats': {'cities': len(cities),
            'countries': len({city['country_code'] or city['country'] for city in cities if city['country_code'] or city['country']}),
            'photos': sum(city['photo_count'] for city in cities), 'without_gps': no_gps,
            'unknown_city': unknown_city, 'total': len(selected)}}
