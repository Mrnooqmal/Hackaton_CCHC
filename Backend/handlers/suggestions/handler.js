const { v4: uuidv4 } = require('uuid');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { created, error } = require('../../lib/utils/response');
const { validateRequired } = require('../../lib/utils/validation');

const SUGGESTIONS_TABLE = process.env.SUGGESTIONS_TABLE || 'Suggestions';

module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const tenantId = body.tenantId
            || event.queryStringParameters?.tenantId
            || event.requestContext?.authorizer?.claims?.['custom:tenantId']
            || null;
        const userId = body.userId
            || event.requestContext?.authorizer?.claims?.sub
            || null;
        const userName = body.userName || body.creatorName || null;
        const message = body.message || body.suggestion || '';

        const validation = validateRequired({ tenantId, userId, message }, ['tenantId', 'userId', 'message']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const now = new Date().toISOString();
        const item = {
            suggestionId: uuidv4(),
            tenantId,
            userId,
            userName,
            message,
            createdAt: now,
        };

        await docClient.send(new PutCommand({
            TableName: SUGGESTIONS_TABLE,
            Item: item,
        }));

        return created({
            suggestionId: item.suggestionId,
            createdAt: item.createdAt,
        });
    } catch (err) {
        console.error('Error creating suggestion:', err);
        return error(err.message, 500);
    }
};
