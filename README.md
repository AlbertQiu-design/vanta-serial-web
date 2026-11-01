# VANTA 串口网页

这是 VANTA ROV 的浏览器控制页。页面通过 Web Serial 连接开发板，在浏览器里选择串口后即可收发数据。

## 运行

需要已安装 Node.js。进入本目录后执行：

```bash
node server.mjs
```

`server.mjs` 默认端口是 **8765**，只监听 `127.0.0.1`。启动后用支持 Web Serial 的 Chromium 系浏览器（Chrome 或 Edge）打开：

http://127.0.0.1:8765

在页面中授权并选择开发板串口。按 Ctrl+C 停止服务。

也可以运行 `npm start`，它会调用现有的 `scripts/web.sh`，同样启动 `server.mjs`，端口仍是 8765。
