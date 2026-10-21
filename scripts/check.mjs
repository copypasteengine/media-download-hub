import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
const root = fileURLToPath(new URL('../', import.meta.url));
let checked = 0;
function syntax(dir) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) syntax(file);
    else if (/\.(mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
      checked++;
    }
  }
}
for (const dir of ['app', 'manager', 'patches', 'tests', 'scripts']) syntax(dir);
const hashes = JSON.parse(readFileSync(path.join(root, 'vendor/xray/checksums.json')));
for (const [arch, expected] of Object.entries(hashes.binaries)) {
  const actual = createHash('sha256').update(readFileSync(path.join(root, 'vendor/xray', arch, 'xray'))).digest('hex');
  if (actual !== expected) throw Error(`Xray ${arch} checksum mismatch`);
}
const version = JSON.parse(readFileSync(path.join(root, 'package.json'))).version;
const mihomo=JSON.parse(readFileSync(path.join(root,'vendor/mihomo/checksums.json')));
for(const [arch,v] of Object.entries(mihomo.assets)){
 const gz=readFileSync(path.join(root,'vendor/mihomo',arch+'.gz'));
 if(createHash('sha256').update(gz).digest('hex')!==v.sha256||createHash('sha256').update(gunzipSync(gz)).digest('hex')!==v.binarySha256)throw Error(`Mihomo ${arch} checksum mismatch`);
}
if (!readFileSync(path.join(root, 'compose.yaml'), 'utf8').includes(`image: media-download-hub:${version}`)) throw Error('Compose and package versions differ');
console.log(`Checked ${checked} JavaScript files, Xray/Mihomo checksums and Compose version.`);
