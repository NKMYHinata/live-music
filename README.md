# Live Music (OBS Overlay)

**Live Music** is a lightweight, high-performance "Now Playing" overlay for OBS Studio, specifically designed for Netease Cloud Music (PC Client). It captures real-time song information, lyrics, and playback progress with minimal system resource usage.

**Live Music** 是一个专为 OBS Studio 设计的轻量级、高性能“当前播放”信息展示组件，特别针对网易云音乐 PC 客户端优化。它能够实时捕获歌名、歌手、封面、歌词以及精确的播放进度。

![Preview](https://via.placeholder.com/600x200?text=Live+Music+Preview)

## ✨ Features (特性)

*   **Real-time Synchronization**: Updates instantly when song changes.
    *   **实时同步**：切歌秒级响应。
*   **Accurate Lyrics**: Captures official lyrics directly from the client.
    *   **精准歌词**：直接捕获客户端的官方歌词数据。
*   **Smart Buffering Handling**: Perfectly syncs with Netease Music's buffering mechanism to avoid premature switching.
    *   **智能缓冲处理**：完美解决网易云预加载导致的提前切歌问题。
*   **Progress Tracking**: Smooth progress bar that supports seeking.
    *   **进度追踪**：支持拖拽进度的平滑进度条。
*   **Zero CPU Usage (Idle)**: Event-driven architecture, 0% CPU usage when idle.
    *   **极低资源占用**：事件驱动架构，空闲时 CPU 占用几乎为 0。
*   **VIP Support**: Works seamlessly with VIP/Paid songs.
    *   **VIP 支持**：完美支持 VIP 付费歌曲的信息获取。

## 🛠️ Installation (安装)

### Prerequisites (前置要求)
*   Node.js (v14+)
*   Netease Cloud Music PC Client (Windows)

### Steps (步骤)

1.  **Clone & Install**
    ```bash
    git clone https://github.com/YourUsername/live-music.git
    cd live-music
    npm install
    ```

2.  **Start Service**
    ```bash
    node index.js
    ```
    *   Proxy Server: `http://127.0.0.1:8001`
    *   Overlay URL: `http://localhost:8003`

3.  **Install Certificate (First Time Only)**
    *   Open `http://localhost:8002/fetchCrtFile` in your browser.
    *   Download and install the `rootCA.crt`.
    *   **Important**: Install it to **"Trusted Root Certification Authorities" (受信任的根证书颁发机构)**.
    *   See [CERTIFICATE_GUIDE.md](CERTIFICATE_GUIDE.md) for details.

4.  **Configure Netease Music**
    *   Settings -> Tools -> HTTP Proxy (设置 -> 工具 -> HTTP 代理)
    *   Select "Custom Proxy" (自定义代理)
    *   Server: `127.0.0.1`
    *   Port: `8001`
    *   Restart Netease Cloud Music.

5.  **Add to OBS**
    *   Add a **Browser Source**.
    *   URL: `http://localhost:8003`
    *   Width: 600, Height: 400 (Adjust as needed).

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
