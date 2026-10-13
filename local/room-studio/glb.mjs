// glTF resources stay embedded so product imports work offline.
export function validateGLB(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('请导入完整的 GLB 2.0 文件。');
  const length = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || length > bytes.length - 20) throw new Error('GLB 的模型描述无效。');
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8').replace(/\0+$/, '').trim());
  for (const resource of [...(json.buffers || []), ...(json.images || [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) throw new Error('模型引用了外部资源。请导出将纹理和几何嵌入文件的 GLB。');
  }
  if (!json.meshes?.length) throw new Error('GLB 中没有物体网格。');
  return json;
}
