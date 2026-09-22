# 丘丘智能抠图使用的开源组件

- 抠图模型：U²-NetP ONNX，来自 [rembg 的 u2netp 模型下载链接](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py)。模型 MD5：`8e83ca70e441ab06c318d82300c84806`。U²-Net 原项目与论文：[xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net)，Apache-2.0 许可文本见 `vendor/U2NET-LICENSE.txt`。
- 浏览器推理运行时：[Microsoft ONNX Runtime Web 1.20.1](https://github.com/microsoft/onnxruntime/tree/v1.20.1/js/web)，MIT 许可文本见 `vendor/ort/ONNXRUNTIME-LICENSE.txt`。

本网站没有直接复制 Jevet 的 Electron 桌面程序代码。Jevet 项目地址：[helson-lin/Jevet](https://github.com/helson-lin/Jevet)。浏览器版使用更小的 U²-NetP 模型；实际边缘质量可能低于 Jevet 的大型模型。
