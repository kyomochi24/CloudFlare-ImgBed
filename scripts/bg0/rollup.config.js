import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: './entry.js',
  plugins: [nodeResolve({ browser: true, exportConditions: ['default', 'browser'] }), commonjs(), json(), terser()],
  output: {
    file: '../../frontend-dist/studio/vendor/bg0/engine.js',
    format: 'es',
    inlineDynamicImports: true
  }
};
