# 丘丘智能抠图使用的开源组件

- 抠图模型：U²-NetP ONNX，来自 [rembg 的 u2netp 模型下载链接](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py)。模型 MD5：`8e83ca70e441ab06c318d82300c84806`。U²-Net 原项目与论文：[xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net)，Apache-2.0 许可文本见 `vendor/U2NET-LICENSE.txt`。
- 浏览器推理运行时：[Microsoft ONNX Runtime Web 1.20.1](https://github.com/microsoft/onnxruntime/tree/v1.20.1/js/web)，MIT 许可文本见 `vendor/ort/ONNXRUNTIME-LICENSE.txt`。

本网站没有直接复制 Jevet 的 Electron 桌面程序代码。Jevet 项目地址：[helson-lin/Jevet](https://github.com/helson-lin/Jevet)。浏览器版使用更小的 U²-NetP 模型；实际边缘质量可能低于 Jevet 的大型模型。

## 字体转换工具

- 感谢 Countertype / Jeremy Tribby 的 [woff-lib 0.0.3](https://github.com/countertype/woff-lib) 与 brotli-lib 0.0.7，均采用 MIT 许可。woff-lib 的 WOFF2 实现衍生自 [Google WOFF2](https://github.com/google/woff2)，版权归属与许可见 `vendor/font-licenses/woff-lib-LICENSE.txt`；brotli-lib 移植自 [Google Brotli](https://github.com/google/brotli)，版权归属与许可见 `vendor/font-licenses/brotli-lib-LICENSE.txt`。
- 感谢 Frederik De Bleser 和贡献者的 [opentype.js 2.0.0](https://github.com/opentypejs/opentype.js)，MIT 许可。用于将 TrueType 字形转换成 OTF CFF 字形。
- 感谢 ecomfe 和贡献者的 [fonteditor-core 2.4.1](https://github.com/kekee000/fonteditor-core)，MIT 许可。用于将 OTF CFF 字形转换成 TrueType 字形。
- 感谢 [@xmldom/xmldom 0.8.15](https://github.com/xmldom/xmldom) 的贡献者，MIT 许可。这是 fonteditor-core 的依赖，已包含在浏览器打包文件中。
- 感谢 Evan Wallace 的 [esbuild 0.25.9](https://github.com/evanw/esbuild)，MIT 许可。用于构建浏览器脚本；构建工具本身没有部署到网站。

以上软件的完整许可文本均保存在 `vendor/font-licenses/`，随网站一同提供。`woff-lib-THIRD-PARTY.txt` 和 `brotli-lib-THIRD-PARTY.txt` 还记录了上游项目测试样例与测试字体的出处；这些测试字体没有打包进本站工具。浏览器运行的打包文件为 `vendor/font-engine.js`，本项目自行编写的集成代码位于 `scripts/font-engine.source.mjs`。MIT 许可允许使用、修改和分发，分发时须保留原版权和许可文本。用户上传或转换的字体另受该字体自身的许可约束，须自行确认是否允许公开托管。
