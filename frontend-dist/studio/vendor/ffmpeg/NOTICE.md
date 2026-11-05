# 视频转 MP3 · 来源与许可

本目录包含 @ffmpeg/ffmpeg 0.12.15 的未修改 ESM JavaScript 文件，来源为 npm 官方注册表，采用 MIT 许可，完整文本见 LICENSE.txt。

https://github.com/ffmpegwasm/ffmpeg.wasm
https://www.npmjs.com/package/@ffmpeg/ffmpeg/v/0.12.15

单线程 @ffmpeg/core 0.12.10 不包含在图床上传包中。仅在用户点击「开始转换」时，从 jsDelivr（失败时尝试 unpkg）下载其官方发布的 ESM 脚本和 WebAssembly，核对固定 SHA-256 后在本机运行。核心采用 GPL-2.0-or-later，并受 FFmpeg 及所用外部库许可约束。

https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core
https://ffmpegwasm.netlify.app/docs/faq/#what-is-the-license-of-ffmpegwasm

视频文件不会发送给这些 CDN。选择视频、转换、试听和下载均在用户设备上进行；主动点击「保存到当前相册」时才向本站上传 MP3。首次工具下载约 31 MiB，浏览器可按 CDN 缓存策略复用下载资源。
