+++
date = '2025-05-09T11:14:53+08:00'
draft = false
title = 'NVIDIA Data Loading Library (DALI)'
+++
[Installtion](https://docs.nvidia.com/deeplearning/dali/user-guide/docs/installation.html)




- loading
- decoding
- augmentation for the image, video, and audio

- GPU Acceleration
- Data Support: Get support for multiple data formats—LMDB,, TFRecord, COCO, JPEG, PNG, TIFF, JPEG2k, wav, flac, ogg, H.26, HEVC, and more.
- Custom Pipelines: Use flexible graphs to create custom pipelines and add custom audio, image, and video processing operators.
- a high-preformance alternative to built-in data loaders and data iterators in popular deep learning frameworks.

Additionally, DALI relies on its own execution engine, built to maximize the throughput of the input pipeline. Features such as prefetching, parallel execution, and batch processing are handled transparently for the user.

At the core of data processing with DALI lies the concept of a data processing pipeline. It is composed of multiple operations connected in a directed graph and contained in an object of class class nvidia.dali.Pipeline. This class provides functions necessary for defining, building and running data processing pipelines.

Augmentation Gallery
Brightness Contrast Example
Color Space Conversion
Image Decoder examples
HSV Example
Using HSV to implement Random Grayscale Operation
Interpolation Methods
Resize Operator
WarpAffine
3D Transforms


It is a single library, that can be easily integrated into different deep learning training and inference applications.

Videos and Webinars
Additional Resources


<img src="images/dali-key-visual-960x428.svg" alt="DALI Key Visual" />

 https://docs.nvidia.com/deeplearning/dali/user-guide/docs/installation.html

 https://github.com/NVIDIA/DALI




Data loaders
dali: Leverages a DALI pipeline along with DALI's PyTorch iterator for data loading, preprocessing, and augmentation.
dali_proxy: Uses a DALI pipeline for preprocessing and augmentation while relying on PyTorch's data loader. DALI Proxy facilitates the transfer of data to DALI for processing.
pytorch: Employs the native PyTorch data loader for data preprocessing and augmentation.


Pipeline



- DataNode: an output of a DALI operator

- 'cpu': operators that accept CPU inputs and produce CPU outputs.
- 'mixed': operators that accept CPU inputs and produce GPU outputs, for example nvidia.dali.fn.decoders.image().
- 'gpu': operators that accept GPU inputs and produce GPU outputs.

Data produced by a CPU operator may be explicitly copied to the GPU by calling .gpu() on a DataNode


Pipeline Decorator

nvidia.dali.pipeline_def

Decorator that converts a graph definition function into a DALI pipeline factory.

ws how to use DALI to load numpy files directly to GPU memory, thanks to NVIDIA GPUDirect Storage, and how to use the region-of-interest (ROI) API to load regions of the array.

https://docs.nvidia.com/deeplearning/dali/user-guide/docs/operations/nvidia.dali.fn.readers.html