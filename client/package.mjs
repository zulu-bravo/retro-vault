// package.mjs - Create ZIP distribution for Vault upload
// Usage: node package.mjs
// Requires: npm run build first
import { createWriteStream, existsSync } from 'fs';
import { execSync } from 'child_process';

if (!existsSync('dist')) {
    console.error('dist/ folder not found. Run `npm run build` first.');
    process.exit(1);
}

const zipName = 'retrovault.zip';

// Remove old zip if it exists
try {
    execSync(`rm -f ${zipName}`);
} catch (e) { /* ignore */ }

// Create zip with dist/, styles/, and distribution-manifest.json
execSync(`zip -rq ${zipName} dist styles distribution-manifest.json`, { stdio: 'inherit' });

console.log(`Packaged: ${zipName}`);
console.log('');
console.log('Deploy with:');
console.log('  curl -L https://$HOST/api/v25.1/uicode/distributions \\');
console.log('    -H "Authorization: $SESSION_ID" \\');
console.log(`    -F "file=@${zipName}"`);
