import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const files=execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const p=`${dir}/${entry.name}`;if(entry.isDirectory())await walk(p);else files.push(p);}}
await walk('frontend/dist');
const failures=[];
for(const file of new Set(files)){let b;try{b=await readFile(file);}catch{continue;}if(b.includes(0))continue;const s=b.toString();if(/(?:gsk_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(s))failures.push(file);}
if(failures.length){console.error('Potential credentials found in:',failures.join(', '));process.exit(1);}
console.log('No known credential patterns in tracked/unignored source or built public assets. This pattern scan is not proof against every secret format.');
