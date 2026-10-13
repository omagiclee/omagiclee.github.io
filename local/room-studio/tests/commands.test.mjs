import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, number, validateDesign } from '../public/commands.js';

test('spoken Chinese lengths preserve units and decimal values', () => {
  assert.equal(number('两'), 2);
  assert.equal(number('二点五'), 2.5);
  assert.deepEqual(parseCommand('把沙发向左移动半米'), { action: 'move', type: 'sofa', direction: '左', distance: .5 });
  assert.equal(parseCommand('桌子向前挪二十厘米').distance, .2);
  assert.equal(parseCommand('把椅子向右移动0.75米').distance, .75);
});
test('unsupported requests cannot silently mutate the room', () => {
  assert.ok(parseCommand('把整个房间变成法式复古风格').error);
  assert.ok(parseCommand('把沙发向左移动五十米').error);
  assert.ok(parseCommand('打开终端删除文件').error);
  assert.deepEqual(parseCommand('墙面改成米白色'), { action: 'wall', color: '#e9e3d5' });
  assert.deepEqual(parseCommand('添加一张桌子'), { action: 'add', type: 'table' });
});
test('design imports reject non-finite values, unknown furniture and duplicate identifiers', () => {
  const design = { version: 1, room: { width: 5, depth: 4, height: 2.8, wallColor: '#e9e3d5', floor: 'oak' }, objects: [{ id: 'chair-1', type: 'chair', x: 0, z: 0, rotation: 0, color: '#abcdef' }] };
  assert.equal(validateDesign(design), true);
  assert.equal(validateDesign({ ...design, objects: [...design.objects, ...design.objects] }), false);
  assert.equal(validateDesign({ ...design, objects: [{ ...design.objects[0], x: Infinity }] }), false);
  assert.equal(validateDesign({ ...design, objects: [{ ...design.objects[0], type: 'script' }] }), false);
});
