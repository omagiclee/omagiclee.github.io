+++
date = '2018-06-03T13:25:36+08:00'
draft = false
title = 'Re'
categories = ['Python']
tags = ['Python', 're']
+++


## Functions
- re.compile
```python
# Compile a regular expression pattern into a regular expression object, which can be used for matching using its match(), search() and other methods.
re.compile

```
- re.findall


regex

正则表达式中，\p是 Unicode 属性的转义符号。它后面通常紧跟着花括号{Property}，用来匹配属于特定 Unicode 分类的字符。

简单来说，传统的 [a-z] 只能匹配英文，而 \p 可以让你根据字符的本质属性（如“它是字母吗？”、“它是标点吗？”、“它是数字吗？”）来匹配全世界所有语言的字符。

\p{Property}：匹配具有该属性的字符。

\P{Property}（大写 P）：匹配不具有该属性的字符（取反）。

属性,全称,匹配范围,示例
\p{L},Letter,任何语言的字母/文字,"A, a, 你, Ж, α"
\p{N},Number,任何形式的数字,"1, ½, 五 (某些引擎), ²"
\p{P},Punctuation,任何标点符号,"!, ?, 。, «"
\p{S},Symbol,数学符号、货币符号,"$, +, ≈, ©, 表情符号"
\p{Z},Separator,各种空格/分隔符,普通空格、全角空格、换行符


## References
- https://docs.python.org/3/library/re.html
- https://pypi.org/project/regex/

