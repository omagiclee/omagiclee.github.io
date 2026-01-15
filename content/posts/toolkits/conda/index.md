+++
date = '2018-06-03T22:05:00+08:00'
draft = false
title = 'Conda'
organization = []
categories = []
tags = []
+++

## Channels
**channel** is a location where conda can search for packages to install.

**default channels**: built and hosted by Anaconda，`defaults` 表示默认复合通道：
- https://repo.anaconda.com/pkgs/main  # 主通道
- https://repo.anaconda.com/pkgs/r  # R 语言通道
- https://repo.anaconda.com/pkgs/free  # 免费通道，历史遗留，新版本已整合到 main
- https://repo.anaconda.com/pkgs/msys2 (Windows only)

**conda-forge** 社区驱动
- https://conda.anaconda.org/conda-forge

```bash
# View channels
conda config --show channels

# 配置 conda search/install/list 时，显示包所来自的镜像 URL
conda config --set show_channel_urls yes

# -------------------------------------------------------------------------------------------------------------------------
# Manage channel configuration in .condarc file
# 配置优先级：用户配置 > 环境配置 > 系统配置，默认仅修改用户配置
# step 1 (查询&收集元数据): 当运行 conda install/create/update 等命令时，conda 首先并行向所有配置 channels 请求元数据（repodata.json）
# step 2 (依赖关系求解): conda 必须成功下载并解析所有配置 channels 的元数据，才会开始进行依赖关系求解。任一请求失败，conda 就会失败报错。
# -------------------------------------------------------------------------------------------------------------------------
conda config --show-sources

# 添加清华源 > 阿里源
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main/
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/free/
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/

# 禁用默认官方源
conda config --remove channels defaults  # 仅修改用户配置，仍需要手动修改系统配置
```

## conda clean
```bash
# 清除索引缓存 (index cache = repodata.json)
conda clean -i

# 清除所有缓存，包含包缓存 (pkgs)/索引缓存 (index cache)/临时文件等
conda clean --all
```
