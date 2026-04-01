import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import path from 'path';

function resolveUnzipit() {
  return {
    name: 'resolve-unzipit',
    resolveId(source) {
      if (source === 'unzipit') {
        return path.resolve('dist/unzipit.module.js');
      }
      if (source === 'worker_threads') {
        return path.resolve('test/ts/worker_threads.js');
      }
      return null;
    },
  };
}

export default {
  input: 'test/ts/ts-test.ts',
  plugins: [
    resolveUnzipit(),
    resolve({
      browser: true,
      preferBuiltins: false,
      modulesOnly: true,
    }),
    typescript({
      tsconfig: 'test/ts/tsconfig.json',
      declaration: false,
    }),
  ],
  output: {
    format: 'es',
    file: 'test/ts/ts-test.js',
    sourcemap: false,
    inlineDynamicImports: true,
  },
};
