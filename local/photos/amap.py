"""Read existing ignored map configuration without executing shell content."""
import os
import shlex
from pathlib import Path

KEYS = ('HUGO_AMAP_WEB_KEY', 'HUGO_AMAP_SECURITY_JSCODE')


def load_amap_config(path, environ=None):
    values = {}
    try:
        for raw in Path(path).read_text().splitlines():
            line = raw.strip()
            if line.startswith('export '):
                line = line[7:]
            name, separator, value = line.partition('=')
            if not separator or name.strip() not in KEYS:
                continue
            tokens = shlex.split(value, comments=True)
            if len(tokens) == 1:
                values[name.strip()] = tokens[0]
    except (OSError, ValueError):
        pass
    environment = os.environ if environ is None else environ
    values.update({key: environment[key] for key in KEYS if environment.get(key)})
    enabled = all(values.get(key) for key in KEYS)
    return {'enabled': enabled, 'key': values.get(KEYS[0], '') if enabled else '',
            'securityCode': values.get(KEYS[1], '') if enabled else ''}
