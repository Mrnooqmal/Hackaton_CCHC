const fs = require('fs');
const path = './handlers/uploads/handler.js';
let content = fs.readFileSync(path, 'utf8');

// Remove the `const s3Client = new S3Client(...)` code and import it
const importStr = "const { s3Client } = require('../../lib/clients/s3');\n";
const toRemove = /const s3Client = new S3Client\(\s*isOffline\s*\?\s*\{\s*region: 'us-east-1',\s*endpoint: 'http:\/\/localhost:4566',\s*forcePathStyle: true,\s*credentials: \{\s*accessKeyId: 'test',\s*secretAccessKey: 'test',\s*\},\s*\}\s*:\s*\{\s*region: process\.env\.AWS_REGION \|\| 'us-east-1'\s*\}\s*\);/g;

content = content.replace(toRemove, importStr);
fs.writeFileSync(path, content, 'utf8');
console.log('Uploads handler patched');
