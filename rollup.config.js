import resolve from 'rollup-plugin-node-resolve';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', {encoding: 'utf8'}));

export default {
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
      banner: `/* unzipit@${pkg.version}, license MIT */`,
    },
    {
      format: 'es',
      file: 'dist/unzipit.module.js',
      indent: '  ',
      banner: `/* unzipit@${pkg.version}, license MIT */`,
    },
  ],
};
