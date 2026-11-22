# pi-selection

> **English** — A Pi extension that turns the code you selected in VS Code into a one-keystroke prompt
> attachment: `/selection` inlines `path:lines` plus the selected source, so the model answers without
> spending a round on `read`.
>
> Chinese documentation below.

把 VS Code 里选中的那几行变成一个按键的 prompt 附件：`/selection` 把 `path:lines` 和源码一起内联进
prompt，模型不用再多跑一轮 `read`。

## 为什么需要它

Pi 没有任何编辑器集成通道：`@file` 补全只插入**路径字符串**，没有任何代码解析行号范围，编辑器里
选中什么 Pi 完全不知道。想看「我现在选的这几行」，模型只能自己调 `read`——每问一次多一轮往返，
而且它得先猜你想给的是哪几行。

这个扩展补上这一步，靠的是 VS Code 扩展
[`ysd.active-context-mcp`](https://marketplace.visualstudio.com/items?itemName=ysd.active-context-mcp)
维护的状态文件：它在每次切换编辑器、移动光标、改变选区时，把活动文件路径、光标位置和选区范围写到
`<tmpdir>/active-context-mcp/active-context.json`。

内容不经 MCP 调用取回：那个 MCP 工具的实现就是读同一个文件再原样返回，所以这里直接读文件——同一份
数据，少一个进程，没有握手失败的可能。

## 依赖

- VS Code，并安装启用了 `ysd.active-context-mcp`：

  ```bash
  code --install-extension ysd.active-context-mcp
  ```

  用 VS Code 的 profile 时需要装进**你实际打开窗口的那个 profile**，否则扩展不存在、状态文件永远不会
  被写出来：`code --profile "<name>" --install-extension ysd.active-context-mcp`。
  同理，不受信窗口（Restricted Mode）会禁用这类扩展。
- 运行 Pi 的机器与 VS Code 同机同用户（状态文件走 `os.tmpdir()`）。
- VS Code 窗口需要开着；关窗口时扩展会删掉状态文件。

## 安装

```bash
pi install npm:@fenlyin/pi-selection
```

之后 `/reload` 或新开会话生效。

可选的第二步：让模型也能主动查当前选区，而不只是等你敲命令。

```bash
pi mcp add vscode-context --exposure direct -- npx -y active-context-mcp
```

## 用法

| 命令 | 行为 |
|---|---|
| `/selection` | 把代码块插进输入框，你再补问题、回车 |
| `/selection <question>` | 代码块和问题一起直接发出 |

插入的内容长这样：

```text
[selection] src/main.py:15-21 — content inlined, no need to read this range
```python
...
```
```

显式写明「不必再 read」是必要的：否则模型看到 `path:lines` 仍会去读一遍，省下的那轮就没了。

## 边界处理

- **行号已 1-based**，与 `read` 的 `offset`/`limit` 同口径。选区若是整行选到行尾，扩展给出的结束行会
  多一行（结束在下一行第 0 列），此时自动减一。
- **没有选区**（只有光标）：退化为光标所在行，并提示一句。
- **未保存的修改**：内联内容来自磁盘。状态文件里的 `activeLineText` 是编辑器自己的当前行文本，与磁盘
  同一行不一致即判定缓冲区有未保存修改并警告——这是唯一能廉价识别未保存 buffer 的信号。
- **状态过期**：`updatedAt` 超过 10 分钟时警告。
- **截断**：超过 400 行或 24000 字符时截断并提示，模型需要时自己 `read` 剩余部分。
- CRLF 归一化，围栏语言按扩展名推断。
- VS Code 没开或没发布状态时给出明确错误，不静默失败。

## 已知限制

- 内联的是磁盘内容，编辑器里未保存的修改不会包含进来（会警告，但无法取到 buffer）。
- 第三方扩展只维护**一份**状态文件，多窗口同时开着时以后聚焦的那个为准。
- 状态文件在 `os.tmpdir()` 下：如果 VS Code 和 Pi 的临时目录不一致（自定义 `TMPDIR`、容器、远程窗口），
  就读不到。远程开发窗口里的文件路径是远端的，同样不适用。

## License

MIT
