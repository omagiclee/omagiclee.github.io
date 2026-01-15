+++
date = '2025-10-20T13:17:03+08:00'
draft = false
title = 'Cuda Installation'
organization = []
categories = []
tags = []
+++


- Perform the pre-installation actions.
- Reboot into text mode (runlevel 3)
    - 在出现 GRUB 菜单 时，快速按下 Shift 来显示启动菜单
    - 在 GRUB 菜单中，选中你当前的 Ubuntu 启动项（通常是第一项），按下键盘上的 e 进入编辑模式。
    - 找到 `linux /boot/vmlinuz-6.xx-xx-generic root=UUID=xxxx ro quiet splash` 
    - 末尾添加参数: `3 nomodeset`
    - 按 F10 保存启动系统



## References
- https://docs.nvidia.com/cuda/cuda-installation-guide-linux/index.html#installation
- 