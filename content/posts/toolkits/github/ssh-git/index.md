+++
date = '2025-10-20T14:53:18+08:00'
draft = false
title = 'ssh git'
organization = []
categories = []
tags = []
+++

- 生成新的 SSH Key: `ssh-keygen -t ed25519 -C "your_email@example.com"`
    - -C 表示给 key 添加注释
- 启动 SSH Agent: `eval "$(ssh-agent -s)"`
- 添加私钥: `ssh-add ~/.ssh/id_ed25519`
- 将公钥添加到 GitHub
- 测试是否连接成功: `ssh -T git@github.com`
