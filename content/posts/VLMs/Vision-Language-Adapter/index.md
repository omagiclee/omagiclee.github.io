+++
date = '2025-12-24T15:04:44+08:00'
draft = false
title = 'Vision Language Adapter'
categories = ['VLMs']
tags = ['VLMs', 'Vision-Language Adapter']
+++

## Motivation
- cross-modal alignment between visual space and text space.
- visual feature compression

##
### cross attention
A single-layer cross-attention module initialized randomly with trainable positon embeddings.

- Qwen-VL
    ```python
    # https://huggingface.co/Qwen/Qwen-VL/blob/main/visual.py
    def get_abs_pos(abs_pos, tgt_size):
        # abs_pos: L, C
        # tgt_size: M
        # return: M, C
        src_size = int(math.sqrt(abs_pos.size(0)))
        tgt_size = int(math.sqrt(tgt_size))
        dtype = abs_pos.dtype

        if src_size != tgt_size:
            return F.interpolate(
                abs_pos.float().reshape(1, src_size, src_size, -1).permute(0, 3, 1, 2),
                size=(tgt_size, tgt_size),
                mode="bicubic",
                align_corners=False,
            ).permute(0, 2, 3, 1).flatten(0, 2).to(dtype=dtype)
        else:
            return abs_pos
    
    class Resampler(nn.Module):
        """
        A 2D perceiver-resampler network with one cross attention layers by
            (grid_size**2) learnable queries and 2d sincos pos_emb
        Outputs:
            A tensor with the shape of (grid_size**2, embed_dim)
        """
        def __init__(
                self,
                grid_size,
                embed_dim,
                num_heads,
                kv_dim=None,
                norm_layer=nn.LayerNorm
        ):
            super().__init__()
            self.num_queries = grid_size ** 2
            self.embed_dim = embed_dim
            self.num_heads = num_heads

            self.pos_embed = nn.Parameter(
                torch.from_numpy(get_2d_sincos_pos_embed(embed_dim, grid_size)).float()
            ).requires_grad_(False)

            self.query = nn.Parameter(torch.zeros(self.num_queries, embed_dim))
            trunc_normal_(self.query, std=.02)

            if kv_dim is not None and kv_dim != embed_dim:
                self.kv_proj = nn.Linear(kv_dim, embed_dim, bias=False)
            else:
                self.kv_proj = nn.Identity()

            self.attn = nn.MultiheadAttention(embed_dim, num_heads)
            self.ln_q = norm_layer(embed_dim)
            self.ln_kv = norm_layer(embed_dim)
            
            self.apply(self._init_weights)

        def _init_weights(self, m):
            if isinstance(m, nn.Linear):
                trunc_normal_(m.weight, std=.02)
                if isinstance(m, nn.Linear) and m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.LayerNorm):
                nn.init.constant_(m.bias, 0)
                nn.init.constant_(m.weight, 1.0)

        def forward(self, x, attn_mask=None):

            pos_embed = get_abs_pos(self.pos_embed, x.size(1))

            x = self.kv_proj(x)
            x = self.ln_kv(x).permute(1, 0, 2)

            N = x.shape[1]
            q = self.ln_q(self.query)
            out = self.attn(
                self._repeat(q, N) + self.pos_embed.unsqueeze(1),
                x + pos_embed.unsqueeze(1),
                x,
                attn_mask=attn_mask)[0]
            return out.permute(1, 0, 2)

        def _repeat(self, query, N: int):
            return query.unsqueeze(1).repeat(1, N, 1)
    ```
### torch.view + MLP(Linear + GELU + Linear)
A single MLP layer to compress adjacent 2x2 tokens into a single token.

- Qwen2-VL
    ```python
    # print(huggingface model)
    (merger): PatchMerger(
        (ln_q): LayerNorm((1280,), eps=1e-06, elementwise_affine=True)
        (mlp): Sequential(
        (0): Linear(in_features=5120, out_features=5120, bias=True)
        (1): GELU(approximate='none')
        (2): Linear(in_features=5120, out_features=1536, bias=True)
        )
    )

    # modeling.py: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_vl/modeling_qwen2_vl.py
    class PatchMerger(nn.Module):
        def __init__(self, dim: int, context_dim: int, spatial_merge_size: int = 2) -> None:
            super().__init__()
            self.hidden_size = context_dim * (spatial_merge_size**2)
            self.ln_q = LayerNorm(context_dim, eps=1e-6)
            self.mlp = nn.Sequential(
                nn.Linear(self.hidden_size, self.hidden_size),
                nn.GELU(),
                nn.Linear(self.hidden_size, dim),
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x = self.mlp(self.ln_q(x).view(-1, self.hidden_size))
            return x
    ```
- Qwen2.5-VL
    ```python
    # print(huggingface model)
    (merger): Qwen2_5_VLPatchMerger(
        (ln_q): Qwen2RMSNorm((1280,), eps=1e-06)
        (mlp): Sequential(
        (0): Linear(in_features=5120, out_features=5120, bias=True)
        (1): GELU(approximate='none')
        (2): Linear(in_features=5120, out_features=2048, bias=True)
        )
    )

    # modeling.py: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_5_vl/modeling_qwen2_5_vl.py
    class Qwen2_5_VLPatchMerger(nn.Module):
        def __init__(self, dim: int, context_dim: int, spatial_merge_size: int = 2) -> None:
            super().__init__()
            self.hidden_size = context_dim * (spatial_merge_size**2)
            self.ln_q = Qwen2RMSNorm(context_dim, eps=1e-6)
            self.mlp = nn.Sequential(
                nn.Linear(self.hidden_size, self.hidden_size),
                nn.GELU(),
                nn.Linear(self.hidden_size, dim),
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x = self.mlp(self.ln_q(x).view(-1, self.hidden_size))
            return x
    ```
- Qwen3-VL
    ```python
    # print(huggingface model)
    (merger): Qwen3VLVisionPatchMerger(
        (norm): LayerNorm((1024,), eps=1e-06, elementwise_affine=True)
        (linear_fc1): Linear(in_features=4096, out_features=4096, bias=True)
        (act_fn): GELU(approximate='none')
        (linear_fc2): Linear(in_features=4096, out_features=2048, bias=True)
    )
    (deepstack_merger_list): ModuleList(
        (0-2): 3 x Qwen3VLVisionPatchMerger(
        (norm): LayerNorm((4096,), eps=1e-06, elementwise_affine=True)
        (linear_fc1): Linear(in_features=4096, out_features=4096, bias=True)
        (act_fn): GELU(approximate='none')
        (linear_fc2): Linear(in_features=4096, out_features=2048, bias=True)
        )
    )

    # modeling.py: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_vl/modeling_qwen3_vl.py
    class Qwen3VLVisionPatchMerger(nn.Module):
        def __init__(self, config: Qwen3VLVisionConfig, use_postshuffle_norm=False) -> None:
            super().__init__()
            self.hidden_size = config.hidden_size * (config.spatial_merge_size**2)
            self.use_postshuffle_norm = use_postshuffle_norm
            self.norm = nn.LayerNorm(self.hidden_size if use_postshuffle_norm else config.hidden_size, eps=1e-6)
            self.linear_fc1 = nn.Linear(self.hidden_size, self.hidden_size)
            self.act_fn = nn.GELU()
            self.linear_fc2 = nn.Linear(self.hidden_size, config.out_hidden_size)

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x = self.norm(x.view(-1, self.hidden_size) if self.use_postshuffle_norm else x).view(-1, self.hidden_size)
            x = self.linear_fc2(self.act_fn(self.linear_fc1(x)))
            return x
    ```


### Conv2d((2, 2), (2, 2)) + GELU + Conv2d((1, 1), (1, 1)) + Linear
- HunyuanOCR
    ```python
    # print(huggingface model)
    (perceive): HunYuanVisionPatchMerger(
        (proj): Sequential(
        (0): Conv2d(1152, 2304, kernel_size=(2, 2), stride=(2, 2))
        (1): GELU(approximate='none')
        (2): Conv2d(2304, 4608, kernel_size=(1, 1), stride=(1, 1))
        )
        (mlp): Linear(in_features=4608, out_features=1024, bias=True)
        (before_rms): HunYuanVLRMSNorm((1152,), eps=1e-05)
        (after_rms): HunYuanVLRMSNorm((1024,), eps=1e-05)
    )

    # model.py: https://github.com/huggingface/transformers/blob/82a06db03535c49aa987719ed0746a76093b1ec4/src/transformers/models/hunyuan_vl/modeling_hunyuan_vl.py
    class HunYuanVisionPatchMerger(nn.Module):
        def __init__(
            self,
            in_channels,
            out_channels,
            spatial_merge_size,
            rms_norm_eps,
            **kwargs,
        ):
            super().__init__()

            embed_std = out_channels**-0.5
            self.spatial_merge_size = spatial_merge_size
            self.proj = nn.Sequential(
                nn.Conv2d(in_channels, in_channels * 2, kernel_size=spatial_merge_size, stride=spatial_merge_size),
                nn.GELU(),
                nn.Conv2d(in_channels * 2, in_channels * 4, kernel_size=1),
            )
            self.mlp = nn.Linear(in_channels * 4, out_channels)
            self.image_newline = nn.Parameter(torch.randn(in_channels * 4) * embed_std)
            self.image_begin = nn.Parameter(torch.randn(out_channels) * embed_std)
            self.image_end = nn.Parameter(torch.randn(out_channels) * embed_std)
            self.image_sep = nn.Parameter(torch.randn(out_channels) * embed_std)

            self.before_rms = HunYuanVLRMSNorm(in_channels, eps=rms_norm_eps)
            self.after_rms = HunYuanVLRMSNorm(out_channels, eps=rms_norm_eps)

        def forward(self, x, size=(16, 16)):
            x = self.before_rms(x) # b, n, c
            h, w = size
            dtype = x.dtype
            x = x.permute(0, 2, 1).reshape(x.shape[0], -1, int(h.item()), int(w.item())) # b, c, h, w. n = hxw
            x = self.proj(x)  # b, 4c, h//2, w//2
            b, c, h, w = x.shape
            x = torch.cat(
                [x, self.image_newline.reshape(1, c, 1, 1).expand(b, c, h, 1).to(dtype, non_blocking=True)], dim=-1
            ) # b, 4c, h//2, w//2+1
            x = x.reshape(b, c, -1).permute(0, 2, 1) # b, 4c, n. n= h//2 * (w//2+1)
            x = self.mlp(x) # b, c, n

            begin = self.image_begin.reshape(1, 1, -1).expand(b, 1, x.shape[-1]).to(dtype, non_blocking=True)
            end = self.image_end.reshape(1, 1, -1).expand(b, 1, x.shape[-1]).to(dtype, non_blocking=True)
            x = torch.cat([begin, x, end], dim=1)

            return self.after_rms(x)
    ```
>

```python
# Qwen3-VL-2B-Instruct
Qwen3VLModel(
  (visual): Qwen3VLVisionModel(
    (patch_embed): Qwen3VLVisionPatchEmbed(
      (proj): Conv3d(3, 1024, kernel_size=(2, 16, 16), stride=(2, 16, 16))
    )
    (pos_embed): Embedding(2304, 1024)
    (rotary_pos_emb): Qwen3VLVisionRotaryEmbedding()
    (blocks): ModuleList(
      (0-23): 24 x Qwen3VLVisionBlock(
        (norm1): LayerNorm((1024,), eps=1e-06, elementwise_affine=True)
        (norm2): LayerNorm((1024,), eps=1e-06, elementwise_affine=True)
        (attn): Qwen3VLVisionAttention(
          (qkv): Linear(in_features=1024, out_features=3072, bias=True)
          (proj): Linear(in_features=1024, out_features=1024, bias=True)
        )
        (mlp): Qwen3VLVisionMLP(
          (linear_fc1): Linear(in_features=1024, out_features=4096, bias=True)
          (linear_fc2): Linear(in_features=4096, out_features=1024, bias=True)
          (act_fn): GELUTanh()
        )
      )
    )
    (merger): Qwen3VLVisionPatchMerger(
      (norm): LayerNorm((1024,), eps=1e-06, elementwise_affine=True)
      (linear_fc1): Linear(in_features=4096, out_features=4096, bias=True)
      (act_fn): GELU(approximate='none')
      (linear_fc2): Linear(in_features=4096, out_features=2048, bias=True)
    )
    (deepstack_merger_list): ModuleList(
      (0-2): 3 x Qwen3VLVisionPatchMerger(
        (norm): LayerNorm((4096,), eps=1e-06, elementwise_affine=True)
        (linear_fc1): Linear(in_features=4096, out_features=4096, bias=True)
        (act_fn): GELU(approximate='none')
        (linear_fc2): Linear(in_features=4096, out_features=2048, bias=True)
      )
    )
  )
  (language_model): Qwen3VLTextModel(
    (embed_tokens): Embedding(151936, 2048)
    (layers): ModuleList(
      (0-27): 28 x Qwen3VLTextDecoderLayer(
        (self_attn): Qwen3VLTextAttention(
          (q_proj): Linear(in_features=2048, out_features=2048, bias=False)
          (k_proj): Linear(in_features=2048, out_features=1024, bias=False)
          (v_proj): Linear(in_features=2048, out_features=1024, bias=False)
          (o_proj): Linear(in_features=2048, out_features=2048, bias=False)
          (q_norm): Qwen3VLTextRMSNorm((128,), eps=1e-06)
          (k_norm): Qwen3VLTextRMSNorm((128,), eps=1e-06)
        )
        (mlp): Qwen3VLTextMLP(
          (gate_proj): Linear(in_features=2048, out_features=6144, bias=False)
          (up_proj): Linear(in_features=2048, out_features=6144, bias=False)
          (down_proj): Linear(in_features=6144, out_features=2048, bias=False)
          (act_fn): SiLUActivation()
        )
        (input_layernorm): Qwen3VLTextRMSNorm((2048,), eps=1e-06)
        (post_attention_layernorm): Qwen3VLTextRMSNorm((2048,), eps=1e-06)
      )
    )
    (norm): Qwen3VLTextRMSNorm((2048,), eps=1e-06)
    (rotary_emb): Qwen3VLTextRotaryEmbedding()
  )
)
```

```python
# Qwen2.5-VL-3B-Instruct
Qwen2_5_VLModel(
  (visual): Qwen2_5_VisionTransformerPretrainedModel(
    (patch_embed): Qwen2_5_VisionPatchEmbed(
      (proj): Conv3d(3, 1280, kernel_size=(2, 14, 14), stride=(2, 14, 14), bias=False)
    )
    (rotary_pos_emb): Qwen2_5_VisionRotaryEmbedding()
    (blocks): ModuleList(
      (0-31): 32 x Qwen2_5_VLVisionBlock(
        (norm1): Qwen2RMSNorm((1280,), eps=1e-06)
        (norm2): Qwen2RMSNorm((1280,), eps=1e-06)
        (attn): Qwen2_5_VLVisionAttention(
          (qkv): Linear(in_features=1280, out_features=3840, bias=True)
          (proj): Linear(in_features=1280, out_features=1280, bias=True)
        )
        (mlp): Qwen2_5_VLMLP(
          (gate_proj): Linear(in_features=1280, out_features=3420, bias=True)
          (up_proj): Linear(in_features=1280, out_features=3420, bias=True)
          (down_proj): Linear(in_features=3420, out_features=1280, bias=True)
          (act_fn): SiLUActivation()
        )
      )
    )
    (merger): Qwen2_5_VLPatchMerger(
      (ln_q): Qwen2RMSNorm((1280,), eps=1e-06)
      (mlp): Sequential(
        (0): Linear(in_features=5120, out_features=5120, bias=True)
        (1): GELU(approximate='none')
        (2): Linear(in_features=5120, out_features=2048, bias=True)
      )
    )
  )
  (language_model): Qwen2_5_VLTextModel(
    (embed_tokens): Embedding(151936, 2048)
    (layers): ModuleList(
      (0-35): 36 x Qwen2_5_VLDecoderLayer(
        (self_attn): Qwen2_5_VLAttention(
          (q_proj): Linear(in_features=2048, out_features=2048, bias=True)
          (k_proj): Linear(in_features=2048, out_features=256, bias=True)
          (v_proj): Linear(in_features=2048, out_features=256, bias=True)
          (o_proj): Linear(in_features=2048, out_features=2048, bias=False)
          (rotary_emb): Qwen2_5_VLRotaryEmbedding()
        )
        (mlp): Qwen2MLP(
          (gate_proj): Linear(in_features=2048, out_features=11008, bias=False)
          (up_proj): Linear(in_features=2048, out_features=11008, bias=False)
          (down_proj): Linear(in_features=11008, out_features=2048, bias=False)
          (act_fn): SiLUActivation()
        )
        (input_layernorm): Qwen2RMSNorm((2048,), eps=1e-06)
        (post_attention_layernorm): Qwen2RMSNorm((2048,), eps=1e-06)
      )
    )
    (norm): Qwen2RMSNorm((2048,), eps=1e-06)
    (rotary_emb): Qwen2_5_VLRotaryEmbedding()
  )
)
```

```python
# Qwen2-VL-2B-Instruct
Qwen2VLModel(
  (visual): Qwen2VisionTransformerPretrainedModel(
    (patch_embed): PatchEmbed(
      (proj): Conv3d(3, 1280, kernel_size=(2, 14, 14), stride=(2, 14, 14), bias=False)
    )
    (rotary_pos_emb): VisionRotaryEmbedding()
    (blocks): ModuleList(
      (0-31): 32 x Qwen2VLVisionBlock(
        (norm1): LayerNorm((1280,), eps=1e-06, elementwise_affine=True)
        (norm2): LayerNorm((1280,), eps=1e-06, elementwise_affine=True)
        (attn): VisionAttention(
          (qkv): Linear(in_features=1280, out_features=3840, bias=True)
          (proj): Linear(in_features=1280, out_features=1280, bias=True)
        )
        (mlp): VisionMlp(
          (fc1): Linear(in_features=1280, out_features=5120, bias=True)
          (act): QuickGELUActivation()
          (fc2): Linear(in_features=5120, out_features=1280, bias=True)
        )
      )
    )
    (merger): PatchMerger(
      (ln_q): LayerNorm((1280,), eps=1e-06, elementwise_affine=True)
      (mlp): Sequential(
        (0): Linear(in_features=5120, out_features=5120, bias=True)
        (1): GELU(approximate='none')
        (2): Linear(in_features=5120, out_features=1536, bias=True)
      )
    )
  )
  (language_model): Qwen2VLTextModel(
    (embed_tokens): Embedding(151936, 1536)
    (layers): ModuleList(
      (0-27): 28 x Qwen2VLDecoderLayer(
        (self_attn): Qwen2VLAttention(
          (q_proj): Linear(in_features=1536, out_features=1536, bias=True)
          (k_proj): Linear(in_features=1536, out_features=256, bias=True)
          (v_proj): Linear(in_features=1536, out_features=256, bias=True)
          (o_proj): Linear(in_features=1536, out_features=1536, bias=False)
          (rotary_emb): Qwen2VLRotaryEmbedding()
        )
        (mlp): Qwen2MLP(
          (gate_proj): Linear(in_features=1536, out_features=8960, bias=False)
          (up_proj): Linear(in_features=1536, out_features=8960, bias=False)
          (down_proj): Linear(in_features=8960, out_features=1536, bias=False)
          (act_fn): SiLUActivation()
        )
        (input_layernorm): Qwen2RMSNorm((1536,), eps=1e-06)
        (post_attention_layernorm): Qwen2RMSNorm((1536,), eps=1e-06)
      )
    )
    (norm): Qwen2RMSNorm((1536,), eps=1e-06)
    (rotary_emb): Qwen2VLRotaryEmbedding()
  )
)
```

```python
# HunyuanOCR
HunYuanVLForConditionalGeneration(
  (model): HunYuanVLModel(
    (embed_tokens): Embedding(120818, 1024, padding_idx=120817)
    (layers): ModuleList(
      (0-23): 24 x HunYuanVLDecoderLayer(
        (self_attn): HunYuanVLAttention(
          (q_proj): Linear(in_features=1024, out_features=2048, bias=False)
          (k_proj): Linear(in_features=1024, out_features=1024, bias=False)
          (v_proj): Linear(in_features=1024, out_features=1024, bias=False)
          (o_proj): Linear(in_features=2048, out_features=1024, bias=False)
          (query_layernorm): HunYuanVLRMSNorm((128,), eps=1e-05)
          (key_layernorm): HunYuanVLRMSNorm((128,), eps=1e-05)
          (rotary_emb): HunYuanVLRotaryEmbedding()
        )
        (mlp): HunYuanVLMLP(
          (gate_proj): Linear(in_features=1024, out_features=3584, bias=False)
          (up_proj): Linear(in_features=1024, out_features=3584, bias=False)
          (down_proj): Linear(in_features=3584, out_features=1024, bias=False)
          (act_fn): SiLUActivation()
        )
        (input_layernorm): HunYuanVLRMSNorm((1024,), eps=1e-05)
        (post_attention_layernorm): HunYuanVLRMSNorm((1024,), eps=1e-05)
      )
    )
    (norm): HunYuanVLRMSNorm((1024,), eps=1e-05)
  )
  (lm_head): Linear(in_features=1024, out_features=120818, bias=False)
  (vit): HunYuanVisionTransformer(
    (embeddings): HunYuanVisionPatchEmbed(
      (patch_embedding): Conv2d(3, 1152, kernel_size=(16, 16), stride=(16, 16))
      (position_embedding): Embedding(16385, 1152)
    )
    (layers): ModuleList(
      (0-26): 27 x HunYuanVisionBlock(
        (self_attn): HunYuanVisionAttention(
          (q_proj): Linear(in_features=1152, out_features=1152, bias=True)
          (k_proj): Linear(in_features=1152, out_features=1152, bias=True)
          (v_proj): Linear(in_features=1152, out_features=1152, bias=True)
          (o_proj): Linear(in_features=1152, out_features=1152, bias=True)
        )
        (mlp): HunYuanVisionMLP(
          (act_fn): GELUActivation()
          (dense_h_to_4h): Linear(in_features=1152, out_features=4304, bias=True)
          (dense_4h_to_h): Linear(in_features=4304, out_features=1152, bias=True)
        )
        (input_layernorm): LayerNorm((1152,), eps=1e-05, elementwise_affine=True)
        (post_attention_layernorm): LayerNorm((1152,), eps=1e-05, elementwise_affine=True)
      )
    )
    (perceive): HunYuanVisionPatchMerger(
      (proj): Sequential(
        (0): Conv2d(1152, 2304, kernel_size=(2, 2), stride=(2, 2))
        (1): GELU(approximate='none')
        (2): Conv2d(2304, 4608, kernel_size=(1, 1), stride=(1, 1))
      )
      (mlp): Linear(in_features=4608, out_features=1024, bias=True)
      (before_rms): HunYuanVLRMSNorm((1152,), eps=1e-05)
      (after_rms): HunYuanVLRMSNorm((1024,), eps=1e-05)
    )
  )
)
```