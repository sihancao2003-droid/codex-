# Codex Whale Widget

这是 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的 Codex 移植版。它保留原项目的鲸鱼娘素材、气泡几何、Q 弹按压、呼吸、拖拽吸边和触摸音效；数据源改为 Codex App Server，显示套餐的 5 小时与每周剩余用量。

## 工作方式

- Codex 插件 Hooks 把任务开始、提示提交、工具调用、确认请求、结束与中断事件写入本机事件流。
- Electron 透明悬浮窗读取事件并播放原有视觉反馈。
- 悬浮窗通过官方 `codex app-server` JSONL 协议读取 `account/rateLimits/read`，按 `100 - usedPercent` 计算剩余比例。
- 用量每分钟刷新，也会在任务结束后立即刷新。不会读取聊天正文，也不会把账户数据发往第三方。

## 启动

安装依赖后可手动运行：

```powershell
npm install
npm start
```

安装为 Codex 插件后，任一已信任此插件 Hooks 的 Codex 任务都会自动唤起挂件。首次启用插件 Hooks 时，Codex 可能要求单独确认信任。

待机时只显示鲸鱼。单击摸头后立即显示 5 小时剩余用量，再点击气泡显示每周剩余用量，并有概率先触发一句彩蛋文案。右键单击鲸鱼可打开设置，切换“小黄鸭 / 音效 1 / 随机 / 关闭”触摸音效，也可编辑彩蛋文案、调整大小和音量；切换音效时会立即试听。拖动鲸鱼会自动吸附屏幕边缘。

## 致谢与许可

原始角色图片、动画、音效和气泡设计来自 MeteorNOX 的 DeepSeek Balance Whale Widget，并依据 MIT License 使用。移植代码同样采用 MIT License，详见 `LICENSE`。
