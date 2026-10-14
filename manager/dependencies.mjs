import fs from 'node:fs';
import {createRequire} from 'node:module';
export const runtimeRequire=createRequire(fs.existsSync('/runtime/package.json')?'/runtime/package.json':new URL('../runtime/app/package.json',import.meta.url));
