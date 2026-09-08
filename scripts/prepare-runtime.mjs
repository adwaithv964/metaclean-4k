import fs from 'node:fs';
import path from 'node:path';
const globalRoot = '/opt/nvm/versions/node/v22.16.0/lib/node_modules/sharp';
const local = path.resolve('node_modules/sharp');
if (fs.existsSync(globalRoot) && !fs.existsSync(local)) {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.symlinkSync(globalRoot, local, 'dir');
  console.log('Linked system-provided sharp runtime:', local);
}
