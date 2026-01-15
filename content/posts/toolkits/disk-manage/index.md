+++
date = '2025-10-20T13:41:48+08:00'
draft = false
title = 'Disk Manage'
organization = []
categories = []
tags = []
+++


## 磁盘自动挂载(开机自动生效)
- 创建挂载点: `sudo mkdir /mnt/data`
- 获取分区 UUID: `sudo blkid /dev/sdb1`
- 编辑 fstab: `sudo vim /etc/fstab`, 末尾添加: `UUID=1234-ABCD /mnt/data ext4 defaults 0 2`
    - UUID: 文件系统的唯一标识符
    - /mnt/data: /mnt/data
    - ext4: 文件系统类型
    - defaults: 挂载选项，表示使用默认参数
    - 0: dump（备份）选项，一般 Linux 很少用，0 表示不做 dump 备份。
    - 2: fsck（文件系统检查）顺序：
        - 0 → 开机不检查
        - 1 → 系统盘（/）优先检查
        - 2 → 其他分区开机检查
        - 系统启动时会按这个顺序检查文件系统的完整性。
- 尝试挂载 /etc/fstab 文件中定义的所有文件系统: `sudo mount -a`
