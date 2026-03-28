/* a simple copy file because all the ones on npm have 1000+ dependencies. */

import fs from 'fs';

const src = process.argv[2];
const dst = process.argv[3];

console.log(src, dst);
fs.copyFileSync(src, dst);
