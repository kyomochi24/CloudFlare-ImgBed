# BG0 browser runtime

This directory contains a browser bundle built from `@bg0/browser` 0.1.1,
`@huggingface/transformers` 3.8.1, and ONNX Runtime Web
`1.22.0-dev.20250409-89f8206ba4`. Rebuild it with `npm ci --ignore-scripts`
and `npm run build` in `scripts/bg0/`.

- [BG0](https://github.com/opencoredev/bg0): Apache-2.0.
- [Transformers.js](https://github.com/huggingface/transformers.js): Apache-2.0.
- [ONNX Runtime](https://github.com/microsoft/onnxruntime): MIT.
- [BiRefNet lite 512 model](https://huggingface.co/studioludens/birefnet-lite-512), pinned to revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`: MIT. The model weights are fetched at runtime and cached in R2, not included in this repository.

See the linked projects for copyright notices, complete license texts, model
limitations, and source code.
