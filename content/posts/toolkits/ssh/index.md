+++
date = '2018-06-03T14:40:53+08:00'
draft = false
title = 'SSH'
organization = []
categories = []
tags = []
+++

```bash
# 生成密钥对
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_a100

# 公钥上传服务器
# -i: IdentityFile
ssh-copy-id -i ~/.ssh/id_a100 -p 25354 root@10.10.9.242  # or ssh-copy-id -i ~/.ssh/id_a100 a100

# 配置 ssh config
Host a100
    HostName 10.10.9.242
    User root
    Port 25354
    ServerAliveInterval 60  # 每60s 发送一次心跳包
    ServerAliveCountMax 3  # 如果连续3次没有响应，断开连接
    IdentityFile ~/.ssh/id_a100  # 私钥文件路径

# 当执行 git clone git@...时，git 通过 ssh 协议连接到远程服务器
ssh-add id_github # 私钥加载到 Agent的 内存中

```