const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const isOffline = process.env.IS_OFFLINE === 'true';

const client = new DynamoDBClient(
    (isOffline && process.env.DYNAMODB_LOCAL === 'true')
        ? {
            region: 'localhost',
            endpoint: 'http://localhost:8000',
            credentials: {
                accessKeyId: 'MockAccessKeyId',
                secretAccessKey: 'MockSecretAccessKey',
            },
        }
        : { region: process.env.AWS_REGION || 'us-east-1' }
);

const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});

module.exports = { docClient };
