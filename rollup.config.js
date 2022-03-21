/* eslint-env node */

'use strict';

const Typescript = require('typescript');
const commonjsPlugin = require('rollup-plugin-commonjs');
const nodeBuiltinsPlugin = require('rollup-plugin-node-builtins');
const nodeResolvePlugin = require('rollup-plugin-node-resolve');
const typescriptPlugin = require('rollup-plugin-typescript');

const Package = require('./package.json');

module.exports = [
  {
    experimentalDynamicImport: true,
    input: 'src/index.ts',
    output: {
      file: Package['main'],
      format: 'umd',
      name: 'PlnkrRuntime',
      sourcemap: true
    },
    plugins: [
      nodeResolvePlugin({
        jsnext: false,
        module: true,
        browser: true,
        extensions: ['.js', '.json'],
        main: true
      }),
      commonjsPlugin({
        include: 'node_modules/**', // Default: undefined
        ignoreGlobal: true,
        ignore: ['fs']
      }),
      nodeBuiltinsPlugin(),
      typescriptPlugin({
        target: 'es5',
        typescript: Typescript
      })
    ]
  },
  {
    input: 'src/index.ts',
    output: {
      file: Package['module'],
      format: 'esm',
      name: 'PlnkrRuntime',
      sourcemap: true
    },
    plugins: [
      nodeResolvePlugin({
        jsnext: false,
        module: true,
        browser: true,
        extensions: ['.js', '.json'],
        main: true
      }),
      commonjsPlugin({
        include: 'node_modules/**', // Default: undefined
        ignoreGlobal: true,
        ignore: ['fs']
      }),
      nodeBuiltinsPlugin(),
      typescriptPlugin({
        target: 'es2018',
        typescript: Typescript
      })
    ]
  }
];
