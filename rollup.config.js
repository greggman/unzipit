import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', {encoding: 'utf8'}));
const banner = `/* unzipit@${pkg.version}, license MIT */`;

export default [
  {
    input: 'src/unzipit.ts',
    plugins: [
      resolve({
        modulesOnly: true,
      }),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
    output: [
      {
        format: 'umd',
        name: 'unzipit',
        file: 'dist/unzipit.js',
        indent: '  ',
        banner,
      },
      {
        format: 'umd',
        name: 'unzipit',
        file: 'dist/unzipit.min.js',
        plugins: [terser()],
        banner,
      },
      {
        format: 'es',
        file: 'dist/unzipit.module.js',
        indent: '  ',
        banner,
      },
    ],
  },
  {
    input: 'src/inflate-worker.ts',
    plugins: [
      resolve({
        modulesOnly: true,
      }),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
    output: [
      {
        format: 'umd',
        name: 'unzipit',
        file: 'dist/unzipit-worker.js',
        indent: '  ',
        banner,
      },
      {
        format: 'umd',
        name: 'unzipit',
        file: 'dist/unzipit-worker.min.js',
        plugins: [terser()],
        banner,
      },
      {
        format: 'es',
        file: 'dist/unzipit-worker.module.js',
        indent: '  ',
        banner,
      },
    ],
  },
];
