import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const issues = [];
for (const file of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('/.env.example') && file !== '.env.example') {
    issues.push(`${file}: real environment files must not be tracked`);
  }
  if (/\.(?:pem|key|pfx|db|sqlite)$/i.test(file)) issues.push(`${file}: private/binary artifact must not be tracked`);
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) continue;
  const lines = bytes.toString('utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line);
    const providerToken = /(?:APP_USR-|TEST-)[A-Za-z0-9-]{25,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(line);
    const webhook = /discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/.test(line);
    if (privateKey || providerToken || webhook) issues.push(`${file}:${index + 1}: possible credential (value redacted)`);
  });
}
if (issues.length) { console.error(issues.join('\n')); process.exit(1); }
console.log(`PASS: ${files.length} tracked files checked; no forbidden environment files or recognized credential formats found.`);
