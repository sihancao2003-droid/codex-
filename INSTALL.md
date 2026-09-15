# Codex 鲸鱼挂件安装指南

这是一个桌面悬浮挂件插件。它保留原版鲸鱼娘的形象、气泡、动画、拖拽吸边和触摸音效，并通过 Codex Hooks 与 App Server 显示五小时和每周套餐剩余用量。

## 方式一：从 GitHub 作为 Codex 插件安装

适合希望由 Codex 管理插件、并让任务自动唤起挂件的用户。

### 1. 准备环境

- Windows 10/11
- 已安装并登录 Codex 桌面版或 Codex CLI
- Node.js 20 或更高版本

确认命令可用：

```powershell
node --version
codex --version
```

### 2. 添加本项目的 marketplace

在 PowerShell 中执行：

```powershell
codex plugin marketplace add sihancao2003-droid/codex- --ref main
```

### 3. 安装插件

```powershell
codex plugin add codex-whale-widget@codex-whale-widget
```

检查安装状态：

```powershell
codex plugin list
```

看到 `codex-whale-widget` 显示为 `installed, enabled` 即表示安装完成。

### 4. 让挂件开始工作

新建一个 Codex 任务并发送消息。首次使用 Hooks 时，Codex 可能会要求确认插件信任；选择允许后，挂件会自动启动。

如果希望不等待新任务、立即启动挂件，可以使用下面的手动启动方式。

## 方式二：下载源码后手动运行

### 1. 下载仓库

```powershell
git clone https://github.com/sihancao2003-droid/codex-.git
cd codex-
```

也可以在 GitHub 页面选择 **Code → Download ZIP**，解压后进入项目目录。

### 2. 安装依赖

```powershell
npm install
```

### 3. 启动挂件

```powershell
npm start
```

或者双击项目目录中的 `launch-widget.vbs`。该脚本会以隐藏命令行窗口的方式启动挂件。

## 使用说明

- 待机时只显示鲸鱼，不显示用量气泡。
- 左键点击鲸鱼：显示五小时剩余百分比。
- 再点击气泡：显示每周剩余百分比，偶尔触发彩蛋文案。
- 右键点击鲸鱼：打开设置菜单。
- 设置菜单可以编辑彩蛋文案、选择触摸音效、调节音量和大小，以及开关“固定最上层”和“结束提醒”。
- 开启“结束提醒”后，Codex 任务结束会立即显示五小时百分比，并在后台补充本轮或当日 token 统计。
- 拖动鲸鱼可以移动位置，松开后会自动吸附到屏幕边缘。

## 更新

如果使用 Codex marketplace 安装：

```powershell
codex plugin marketplace upgrade codex-whale-widget
codex plugin add codex-whale-widget@codex-whale-widget
```

如果使用源码方式安装：

```powershell
cd codex-
git pull
npm install
```

更新后建议重新打开一个 Codex 任务，使新版 Hooks 生效。

## 卸载

卸载 Codex 插件：

```powershell
codex plugin remove codex-whale-widget@codex-whale-widget
```

如果不再需要 marketplace，也可以移除它：

```powershell
codex plugin marketplace remove codex-whale-widget
```

源码版直接删除项目目录即可；运行中的挂件可先右键鲸鱼并选择“退出挂件”。

## 常见问题

### 安装后没有显示鲸鱼

先手动运行 `npm start`，确认 Electron 挂件本身可以启动；然后重新打开一个 Codex 任务，并确认首次出现的 Hooks 信任提示。

### 看不到最新用量

点击气泡或设置菜单中的“刷新用量”。Codex 套餐百分比由 App Server 返回；账户统计或单轮 token 数据暂不可用时，挂件会显示相应提示，不会估算虚假数值。

### 菜单或挂件被其他窗口挡住

右键鲸鱼，打开“固定最上层”。该选项默认开启，也可以随时关闭。

## 隐私说明

挂件只读取本机 Codex Hooks 事件和 Codex App Server 的账户用量接口，不读取聊天正文，也不会将账户数据发送到第三方服务。

## 项目地址

[https://github.com/sihancao2003-droid/codex-](https://github.com/sihancao2003-droid/codex-)
