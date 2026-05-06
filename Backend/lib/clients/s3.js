const { S3Client } = require('@aws-sdk/client-s3');

const isOffline = process.env.IS_OFFLINE === 'true';

// Configuración del cliente S3
const s3Client = new S3Client(
    isOffline
        ? {
            region: 'us-east-1',
            endpoint: 'http://localhost:4566', // LocalStack para desarrollo
            forcePathStyle: true,
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        }
        : {
            region: process.env.AWS_REGION || 'us-east-1',
        }
);

module.exports = { s3Client };
