import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateGLB } from '../glb.mjs';
import { objectSpec, validateDesign } from '../public/commands.js';
import { productTemplate, instantiateProduct, floorAlignment } from '../public/real-space.js';

function glb(json) {
  let text = JSON.stringify(json); text += ' '.repeat((4 - Buffer.byteLength(text) % 4) % 4);
  const data = Buffer.from(text), bytes = Buffer.alloc(20 + data.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(data.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); data.copy(bytes, 20); return bytes;
}
test('product files reject external texture and buffer references', () => {
  assert.throws(() => validateGLB(glb({ meshes: [{}], images: [{ uri: 'https://example.com/texture.png' }] })), /外部资源/);
  assert.throws(() => validateGLB(glb({ meshes: [{}], buffers: [{ uri: 'file:///etc/passwd' }] })), /外部资源/);
  assert.throws(() => validateGLB(Buffer.from('not a model')), /GLB/);
});
test('physical width scales all product axes uniformly and its base rests on the floor', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.8, .9, .6), new THREE.MeshStandardMaterial({ color: '#336655', roughness: .31 }));
  mesh.position.set(7, 10, -3); const root = new THREE.Group(); root.add(mesh);
  const template = productTemplate(root), product = instantiateProduct(template, 1.6);
  product.updateMatrixWorld(true); const bounds = new THREE.Box3().setFromObject(product); const size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 1.6) < .0001); assert.ok(Math.abs(size.y - 1.8) < .0001); assert.ok(Math.abs(size.z - 1.2) < .0001); assert.ok(Math.abs(bounds.min.y) < .0001);
  assert.equal(product.children[0].children[0].material.roughness, .31);
  assert.equal(product.children[0].children[0].material.color.getHexString(), '336655');
});
test('a tilted floor aligns to world up; collinear points are rejected', () => {
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 0), new THREE.Vector3(0, 0, 1)];
  const q = floorAlignment(points, new THREE.Vector3(-2, 3, 2));
  const normal = new THREE.Vector3(-1, 1, 0).normalize().applyQuaternion(q); assert.ok(normal.distanceTo(new THREE.Vector3(0, 1, 0)) < .0001);
  assert.throws(() => floorAlignment([new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0)], new THREE.Vector3(0, 3, 0)), /同一直线/);
});
test('saved product dimensions remain valid and unknown product references are rejected', () => {
  const item = { id: 'product-1', type: 'product', name: '我的椅子', assetId: '12345678-1234-1234-1234-123456789abc', assetDimensions: { width: .8, height: .9, depth: .6 }, realWidth: 1.6, x: 0, y: 0, z: 0, rotation: 0, color: '#ffffff' };
  const design = { version: 1, source: 'empty', room: { width: 5, depth: 4, height: 2.8, wallColor: '#e9e3d5', floor: 'oak' }, objects: [item] };
  assert.equal(validateDesign(design), true); assert.equal(objectSpec(item).width, 1.6);
  assert.equal(validateDesign({ ...design, objects: [{ ...item, assetId: '../../secrets' }] }), false);
  assert.equal(validateDesign({ ...design, objects: [{ ...item, realWidth: NaN }] }), false);
});
