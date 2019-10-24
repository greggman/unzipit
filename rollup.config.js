import resolve from 'rollup-plugin-node-resolve';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', {encoding: 'utf8'}));
const banner = `/* unzipit@${pkg.version}, license MIT */`;

export default [
  {
    input: 'src/unzipit.js',
    plugins: [
      resolve({
        modulesOnly: true,
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
        format: 'es',
        file: 'dist/unzipit.module.js',
        indent: '  ',
        banner,
      },
    ],
  },
  {
    input: 'src/inflate-worker.js',
    plugins: [
      resolve({
        modulesOnly: true,
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
        format: 'es',
        file: 'dist/unzipit-worker.module.js',
        indent: '  ',
        banner,
      },
    ],
  },
];
