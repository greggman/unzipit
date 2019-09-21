import resolve from 'rollup-plugin-node-resolve';

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
    },
    {
      format: 'es',
      file: 'dist/unzipit.module.js',
      indent: '  ',
    },
  ],
};
