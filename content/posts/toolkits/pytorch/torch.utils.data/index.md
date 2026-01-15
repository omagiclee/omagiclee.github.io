+++
date = '2025-05-13T20:21:22+08:00'
draft = false
title = 'torch.utils.data API'
+++


Dataset: store the samples and their corresponding labels

Dataloader: wraps an iterable around the Dataset

domain-specific libraries, such as TorcText, TorchVision and TorchAudio.


## torch.utils.data.Dataset

[torch.utils.data.Dataset](https://docs.pytorch.org/docs/stable/data.html#torch.utils.data.Dataset): base class representing a Dataset.

### Map-style datasets

```python
import os
import pandas as pd

class CustomDataset(Dataset):
    def __init__(self, annotations_file, img_dir, transform=None, target_transform=None):
        self.img_labels = pd.read_csv(annotations_file)
        self.img_dir = img_dir
        self.transform = transform
        self.target_transform = target_transform

    # __len__() return the size of the dataset by many Sampler implementations and the default options of DataLoader.
    def __len__(self):
        return len(self.img_labels)

    # __getitem__() supports fetching a data sample for a given key. 
    def __getitem__(self, idx):
        img_path = os.path.join(self.img_dir, self.img_labels.iloc[idx, 0])
        image = read_image(img_path)
        label = self.img_labels.iloc[idx, 1]
        if self.transform:
            image = self.transform(image)
        if self.target_transform:
            label = self.target_transform(label)
        return image, label
```

### Iterable-style datasets

### Dataset libraries

**All datasets are subclasses of torch.utils.data.Dataset**

- torchvision.datasets: [torchvision.datasets](https://docs.pytorch.org/vision/stable/datasets.html) provides many built-in datasets, as well as utility classes for building your own datasets.
- torchtext.datasets
- torchaudio.datasets

## torch.utils.data.Sampler

```python
class AccedingSequenceLengthSampler(Sampler[int]):
    def __init__(self, data: List[str]) -> None:
        self.data = data
    def __len__(self) -> int:
        return len(self.data)
    def __iter__(self) -> Iterator[int]:
        sizes = torch.tensor([len(x) for x in self.data])
        yield from torch.argsort(sizes).tolist()
class AccedingSequenceLengthBatchSampler(Sampler[List[int]]):
    def __init__(self, data: List[str], batch_size: int) -> None:
        self.data = data
        self.batch_size = batch_size
    def __len__(self) -> int:
        return (len(self.data) + self.batch_size - 1) // self.batch_size
    def __iter__(self) -> Iterator[List[int]]:
        sizes = torch.tensor([len(x) for x in self.data])
        for batch in torch.chunk(torch.argsort(sizes), len(self)):
            yield batch.tolist()
```

## torch.utils.data.DataLoader

DataLoader wraps an iterable around the Dataset to enable easy access to the samples.

https://docs.pytorch.org/tutorials/beginner/basics/data_tutorial.html

Creating a Custom Dataset for your files
A custom Dataset class must implement three functions: __init__, __len__, and __getitem__.

```python


from torch.utils.data import DataLoader

train_dataloader = DataLoader(training_data, batch_size=64, shuffle=True)

train_features, train_labels = next(iter(train_dataloader))
```

https://docs.pytorch.org/docs/stable/data.html
