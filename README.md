# Live Music (网易云音乐助手 / OBS Overlay)

> **注意 (Note):**
> 当前版本仅支持网易云音乐 (Currently only supports Netease Cloud Music).
>
> **重要警告 (Important Warning):**
> 配置网易云音乐代理后，**必须启动本软件**才能正常使用网易云音乐。如果不使用本软件，请务必在网易云音乐设置中关闭代理，否则将无法联网。
> (Once the proxy is configured in Netease Cloud Music, **this software MUST be running** for Netease Cloud Music to work. If you are not using this software, please disable the proxy in Netease Cloud Music settings, otherwise it will not be able to connect to the network.)

**Live Music** 是一个专为 OBS Studio 设计的轻量级、高性能“当前播放”信息展示组件，特别针对网易云音乐 PC 客户端优化。它能够实时捕获歌名、歌手、封面、歌词以及精确的播放进度。

**Live Music** is a lightweight, high-performance "Now Playing" overlay for OBS Studio, specifically designed for Netease Cloud Music (PC Client). It captures real-time song information, lyrics, and playback progress with minimal system resource usage.

![Preview](https://via.placeholder.com/600x200?text=Live+Music+Preview)

## ✨ 特性 (Features)

*   **实时同步 (Real-time Synchronization)**: 切歌秒级响应。 (Updates instantly when song changes.)
*   **精准歌词 (Accurate Lyrics)**: 直接捕获客户端的官方歌词数据。 (Captures official lyrics directly from the client.)
*   **智能缓冲处理 (Smart Buffering Handling)**: 完美解决网易云预加载导致的提前切歌问题。 (Perfectly syncs with Netease Music's buffering mechanism to avoid premature switching.)
*   **进度追踪 (Progress Tracking)**: 支持拖拽进度的平滑进度条。 (Smooth progress bar that supports seeking.)
*   **极低资源占用 (Zero CPU Usage when Idle)**: 事件驱动架构，空闲时 CPU 占用几乎为 0。 (Event-driven architecture, 0% CPU usage when idle.)
*   **VIP 支持 (VIP Support)**: 完美支持 VIP 付费歌曲的信息获取。 (Works seamlessly with VIP/Paid songs.)

## 📐 Use Case Diagram (用例图)

![Use Case Diagram](https://github.com/user-attachments/assets/11c5d899-09e3-49ac-8ce7-4446200b68ce)

## 🛠️ 安装与使用 (Installation & Usage)

### 1. 下载与安装 (Download & Install)

#### 源码运行 (Run from Source)
1.  确保已安装 [Node.js](https://nodejs.org/) (v14+).
2.  克隆仓库并安装依赖:
    ```bash
    git clone https://github.com/YourUsername/live-music.git
    cd live-music
    npm install
    ```
3.  启动服务:
    ```bash
    node index.js
    # 或者 / Or
    npm start
    ```

#### 打包版本 (Executable)
(如果有发布版本，可以在此下载 / If releases are available, download here)

### 2. 安装 CA 证书 (Install CA Certificate)

**这是最关键的一步，用于解密 HTTPS 流量。 / This is the most critical step for decrypting HTTPS traffic.**

1.  启动本软件后，在浏览器中访问: `http://localhost:8002/fetchCrtFile`
2.  下载 `rootCA.crt` 文件。
3.  **安装步骤 (Windows):**
    *   双击下载的 `rootCA.crt` 文件。
    *   点击 **"安装证书" (Install Certificate)**。
    *   存储位置选择 **"当前用户" (Current User)** -> 下一步。
    *   选择 **"将所有的证书都放入下列存储" (Place all certificates in the following store)**。
    *   点击 **"浏览" (Browse)**，选择 **"受信任的根证书颁发机构" (Trusted Root Certification Authorities)** -> 确定 -> 下一步 -> 完成。
    *   在弹出的安全警告中点击 **"是" (Yes)**。

### 3. 设置网易云音乐代理 (Configure Netease Music Proxy)

1.  打开网易云音乐 PC 客户端。
2.  点击右上角的齿轮图标进入 **"设置" (Settings)**。
3.  选择 **"工具" (Tools)** 选项卡。
4.  找到 **"HTTP代理" (HTTP Proxy)** 部分。
5.  选择 **"自定义代理" (Custom Proxy)**。
6.  填写以下信息:
    *   **服务器 (Server):** `127.0.0.1`
    *   **端口 (Port):** `8001` (默认端口，可在本软件设置中修改)
7.  点击 **"测试" (Test)** 按钮，如果提示 "代理可用" (Proxy available)，则说明配置成功。
    *   *注意：此时必须保持本软件运行，否则测试会失败。*
8.  点击 **"确定" (OK)** 重启网易云音乐。

### 4. 导入 OBS (Import to OBS)

1.  打开 OBS Studio。
2.  在 "来源" (Sources) 面板点击 `+` 号，选择 **"浏览器" (Browser)**。
3.  新建一个源，名称任意 (例如 "Music Overlay")。
4.  在属性窗口中设置:
    *   **URL:** `http://localhost:8003` (默认端口)
        *   或者使用歌词页: `http://localhost:8003/lyrics.html`
    *   **宽度 (Width):** `600` (根据需要调整)
    *   **高度 (Height):** `200` (根据需要调整)
    *   勾选 **"在源不显示时关闭浏览器" (Shutdown source when not visible)** 以节省资源 (可选)。
    *   勾选 **"刷新浏览器当场景变为活动" (Refresh browser when scene becomes active)** (可选)。
5.  点击 **"确定" (OK)**。

现在，当你在网易云音乐播放歌曲时，OBS 中应该会显示相应的信息。

## ⚙️ 配置 (Configuration)

你可以通过右键点击系统托盘图标，选择 **"设置" (Settings)** 来打开配置页面 (`http://localhost:8003/settings.html`)。
在此页面可以调整:
*   外观主题 (颜色、形状、布局)
*   歌词样式 (字体、模糊、对齐)
*   端口设置

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
