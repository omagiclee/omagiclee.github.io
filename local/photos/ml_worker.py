"""Offline, persistent SigLIP2 worker; JSON-lines protocol on private pipes."""
import argparse
import json
import os
import sys

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
from taxonomy import CATEGORIES, TYPE_PROMPTS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    import torch
    import torch.nn.functional as F
    from PIL import Image, ImageOps
    from transformers import AutoModel, AutoProcessor
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    dtype = torch.float16 if device == 'mps' else torch.float32
    torch.set_num_threads(4)
    processor = AutoProcessor.from_pretrained(args.model, local_files_only=True, trust_remote_code=False)
    model = AutoModel.from_pretrained(args.model, local_files_only=True, trust_remote_code=False, dtype=dtype).to(device).eval()

    def normalized(output):
        value = output if torch.is_tensor(output) else output.pooler_output
        value = value.float()
        if not torch.isfinite(value).all() or (value.norm(dim=-1) < 1e-8).any():
            raise ValueError('模型返回无效向量')
        return F.normalize(value, p=2, dim=-1)

    def text_vectors(values):
        batches = []
        for start in range(0, len(values), 12):
            inputs = processor(text=[text.lower() for text in values[start:start+12]], padding='max_length', max_length=64, truncation=True, return_tensors='pt')
            batches.append(normalized(model.get_text_features(**{key: value.to(device) for key, value in inputs.items()}, return_dict=True)))
        return torch.cat(batches)

    with torch.inference_mode():
        category_ids = list(CATEGORIES)
        categories = text_vectors([f'This is {CATEGORIES[key][1]}.' for key in category_ids])
        types = text_vectors([f'This is {prompt}.' for _, prompt in TYPE_PROMPTS])
    size = model.config.vision_config.image_size
    key = f'siglip2@{args.revision}/rgb{size}-float32-l2-v1'
    print(json.dumps({'ready': True, 'model': key, 'device': device, 'dimensions': int(categories.shape[-1])}), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with torch.inference_mode():
                if request['operation'] == 'text':
                    vectors = text_vectors([request['query']])
                    result = {'model': key, 'dimensions': int(vectors.shape[-1]), 'vectors': vectors.cpu().tolist()}
                elif request['operation'] == 'images':
                    images = []
                    for path in request['paths']:
                        with Image.open(path) as source:
                            images.append(ImageOps.exif_transpose(source).convert('RGB'))
                    inputs = processor(images=images, return_tensors='pt')
                    inputs = {name: value.to(device, dtype=dtype) if value.is_floating_point() else value.to(device) for name, value in inputs.items()}
                    vectors = normalized(model.get_image_features(**inputs, return_dict=True))
                    scores, type_scores = vectors @ categories.T, vectors @ types.T
                    suggestions = []
                    for row, type_row in zip(scores, type_scores):
                        values, indices = row.topk(3)
                        suggestions.append({'category': category_ids[indices[0].item()],
                            'media_type': TYPE_PROMPTS[type_row.argmax().item()][0],
                            'similarity': values[0].item(), 'margin': (values[0]-values[1]).item(),
                            'alternatives': [category_ids[index] for index in indices.tolist()]})
                    result = {'model': key, 'dimensions': int(vectors.shape[-1]), 'vectors': vectors.cpu().tolist(), 'suggestions': suggestions}
                else:
                    raise ValueError('不支持的模型操作')
            print(json.dumps(result, allow_nan=False), flush=True)
        except Exception as error:
            print(json.dumps({'error': str(error)}), flush=True)


if __name__ == '__main__':
    main()
