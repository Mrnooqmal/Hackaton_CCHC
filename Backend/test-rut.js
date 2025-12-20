const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./lib/dynamodb');

async function test() {
    console.log('Checking Workers table...');
    const result = await docClient.send(new ScanCommand({
        TableName: 'hackatonbackend-workers-alonso',
        Limit: 5
    }));
    console.log('Workers found:', result.Items.length);
    result.Items.forEach(w => {
        console.log('  RUT:', w.rut, '| habilitado:', w.habilitado, '| hasPin:', !!w.pinHash);
    });

    console.log('\nChecking Users table...');
    const users = await docClient.send(new ScanCommand({
        TableName: 'hackatonbackend-users-alonso',
        Limit: 5
    }));
    console.log('Users found:', users.Items.length);
    users.Items.forEach(u => {
        console.log('  RUT:', u.rut, '| workerId:', u.workerId || 'N/A', '| rol:', u.rol);
    });
}
test().catch(console.error);
