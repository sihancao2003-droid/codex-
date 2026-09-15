# Codex Whale Widget

这是 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的 Codex 移植版。它保留原项目的鲸鱼娘素材、气泡几何、Q 弹按压、呼吸、拖拽吸边和触摸音效；数据源改为 Codex App Server，显示套餐的 5 小时与每周剩余用量。

## 工作方式

挂件支持两个智能体数据源，可在右键菜单的「智能体」中随时切换：

- **Codex**：插件 Hooks 把任务开始、提示提交、工具调用、确认请求、结束与中断事件写入本机事件流；悬浮窗通过官方 `codex app-server` JSONL 协议读取 `account/rateLimits/read`，按 `100 - usedPercent` 计算剩余比例。
- **ZCode**：通过 ZCode 官方 `billing/balance` 接口读取模型/试用额度，并通过 BigModel 官方 `monitor/usage/quota/limit` 接口读取个人套餐的 5 小时与每周窗口；同时监听 `~/.zcode/cli/rollout/model-io-*.jsonl` 会话日志，统计今日已用 tokens（按模型分解），并据此驱动「工作中 / 任务结束」动画，无需额外配置。

ZCode 鉴权复用本机 ZCode 客户端的登录凭据（`~/.zcode/v2/credentials.json`，AES-256-GCM 加密，仅本机可解），不会把账户数据发往第三方；登录过期时挂件会提示重新打开 ZCode 登录。

- Electron 透明悬浮窗读取事件并播放原有视觉反馈。
- 用量每分钟刷新，也会在任务结束后立即刷新。
- 余额预警：剩余额度低于设定阈值（默认 20%，可关闭）时自动弹出提示气泡。

## 使用说明（ZCode 余额监控）

- 切换到 ZCode 后，单击鲸鱼显示个人套餐 5 小时剩余百分比，气泡注明「剩余 x / 总量」和重置时间；再点气泡显示每周剩余百分比，之后可查看「今日已用」（含按模型的 token 分解）。模型/试用额度仍保留在后台数据中，用于兼容和诊断，不再冒充 5 小时/每周余额。
- ZCode 任务进行中，鲸鱼弹出「工作中」气泡；任务结束显示本轮消耗 tokens 和最新剩余额度。
- 剩余额度低于阈值时自动弹出「余额预警」。

## 启动

面向其他用户的完整下载、安装、更新和卸载说明见 [INSTALL.md](INSTALL.md)。

上游功能映射与 token/credits 消耗说明见 [UPSTREAM-FEATURES.md](UPSTREAM-FEATURES.md)。

安装依赖后可手动运行：

```powershell
npm install
npm start
```

安装为 Codex 插件后，任一已信任此插件 Hooks 的 Codex 任务都会自动唤起挂件。首次启用插件 Hooks 时，Codex 可能要求单独确认信任。

待机时只显示鲸鱼。单击摸头后立即显示 5 小时剩余用量，再点击气泡显示每周剩余用量，并有概率先触发一句彩蛋文案。右键单击鲸鱼可打开设置，切换“小黄鸭 / 音效 1 / 随机 / 关闭”触摸音效，也可编辑彩蛋文案、调整大小和音量；切换音效时会立即试听。菜单会在小尺寸下滚动，保证“大小”设置不会被裁切。“固定最上层”默认开启，可随时关闭，让鲸鱼允许被其他窗口覆盖。每次任务结束时，开启“结束提醒”后会立即显示 5 小时剩余百分比，并在后台刷新；若 Codex 事件或账户统计提供 token 计数，会同时显示本轮或当日 token 数，否则会明确提示计数暂不可用。拖动鲸鱼会自动吸附屏幕边缘。

## 致谢与许可

原始角色图片、动画、音效和气泡设计来自 MeteorNOX 的 DeepSeek Balance Whale Widget，并依据 MIT License 使用。移植代码同样采用 MIT License，详见 `LICENSE`。
