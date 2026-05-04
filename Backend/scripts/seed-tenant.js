/**
 * Script de Seed: Crear tenant de prueba con obra y personas
 * 
 * Ejecutar: node scripts/seed-tenant.js --stage dev
 * 
 * Crea:
 * 1. Un tenant de prueba
 * 2. Una obra con fases DS 44
 * 3. Un admin, un prevencionista, y 3 trabajadores
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Config
const args = process.argv.slice(2);
const stage = args.find(a => a.startsWith('--stage'))?.split('=')[1]
    || args[args.indexOf('--stage') + 1]
    || 'dev';

const SERVICE_NAME = 'HackatonBackend';
const TENANTS_TABLE = `${SERVICE_NAME}-tenants-${stage}`;
const OBRAS_TABLE = `${SERVICE_NAME}-obras-${stage}`;
const PERSONAS_TABLE = `${SERVICE_NAME}-personas-${stage}`;

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

// Simple hash for seed passwords
const hashPassword = (pass, salt) => {
    return crypto.createHash('sha256').update(pass + salt).digest('hex');
};

async function main() {
    console.log(`=== Seed Tenant (stage: ${stage}) ===\n`);

    const tenantId = uuidv4();
    const obraId = uuidv4();
    const now = new Date().toISOString();

    // ---- 1. TENANT ----
    const tenant = {
        PK: `TENANT#${tenantId}`,
        SK: 'METADATA#',
        tenantId,
        nombre: 'Constructora Demo SpA',
        rutEmpresa: '76.123.456-7',
        slug: 'constructora-demo',
        plan: 'profesional',
        estado: 'activo',
        cantidadTrabajadores: 50,
        tamano: 'mediana',
        settings: {
            timezone: 'America/Santiago',
            idioma: 'es',
            logo: null,
            colores: { primario: '#1E40AF', secundario: '#F59E0B' }
        },
        reglas: {
            pinObligatorio: true,
            firmaDigitalRequerida: true,
            diasVencimientoDocumento: 30,
            fasesObligatorias: ['excavacion', 'obra_gruesa', 'terminaciones', 'entrega']
        },
        contacto: {
            email: 'admin@constructorademo.cl',
            telefono: '+56912345678'
        },
        createdAt: now,
        updatedAt: now
    };

    await docClient.send(new PutCommand({ TableName: TENANTS_TABLE, Item: tenant }));
    console.log(`Tenant creado: ${tenant.nombre} (${tenantId})`);

    // ---- 2. OBRA ----
    const obra = {
        PK: `TENANT#${tenantId}`,
        SK: `OBRA#${obraId}`,
        obraId,
        tenantId,
        nombre: 'Edificio Central - Etapa 1',
        direccion: 'Av. Providencia 1234, Santiago',
        mandante: 'Inmobiliaria Demo',
        faseActual: 'obra_gruesa',
        fasesConfig: {
            excavacion: {
                documentosObligatorios: ['IRL', 'POLITICA_SSO', 'REGLAMENTO_INTERNO', 'MAPA_RIESGOS'],
                completada: true
            },
            obra_gruesa: {
                documentosObligatorios: ['PROCEDIMIENTO_TRABAJO', 'ENTREGA_EPP', 'CAPACITACION'],
                completada: false
            },
            terminaciones: {
                documentosObligatorios: ['TEST_EVALUACION', 'ENCUESTA_SALUD'],
                completada: false
            },
            entrega: {
                documentosObligatorios: ['CAPACITACION', 'ENTREGA_EPP'],
                completada: false
            }
        },
        estado: 'activa',
        fechaInicio: '2026-01-15',
        fechaEstimadaFin: '2027-06-30',
        createdAt: now,
        updatedAt: now
    };

    await docClient.send(new PutCommand({ TableName: OBRAS_TABLE, Item: obra }));
    console.log(`Obra creada: ${obra.nombre} (${obraId})`);

    // ---- 3. PERSONAS ----
    const personasData = [
        {
            nombre: 'Carlos', apellido: 'Mendez', rut: '12.345.678-9',
            email: 'carlos.mendez@constructorademo.cl',
            rol: 'admin', cargo: 'Gerente de Operaciones',
            tieneAccesoWeb: true
        },
        {
            nombre: 'Maria', apellido: 'Lopez', rut: '13.456.789-0',
            email: 'maria.lopez@constructorademo.cl',
            rol: 'prevencionista', cargo: 'Prevencionista de Riesgos',
            tieneAccesoWeb: true
        },
        {
            nombre: 'Juan', apellido: 'Perez', rut: '14.567.890-1',
            rol: 'trabajador', cargo: 'Maestro Albañil',
            tieneAccesoWeb: false
        },
        {
            nombre: 'Pedro', apellido: 'Gonzalez', rut: '15.678.901-2',
            rol: 'trabajador', cargo: 'Operador Grua',
            tieneAccesoWeb: false
        },
        {
            nombre: 'Ana', apellido: 'Torres', rut: '16.789.012-3',
            rol: 'relator', cargo: 'Relatora SST',
            email: 'ana.torres@constructorademo.cl',
            tieneAccesoWeb: true
        }
    ];

    for (const data of personasData) {
        const personaId = uuidv4();
        const tempPassword = `Demo${Math.random().toString(36).slice(2, 8)}`;

        const persona = {
            PK: `TENANT#${tenantId}`,
            SK: `PERSONA#${personaId}`,
            personaId,
            tenantId,
            rut: data.rut,
            nombre: data.nombre,
            apellido: data.apellido,
            rol: data.rol,
            cargo: data.cargo,
            tieneAccesoWeb: data.tieneAccesoWeb,
            passwordTemporal: data.tieneAccesoWeb,
            habilitado: data.tieneAccesoWeb, // Workers need enrollment
            estado: 'activo',
            obraId,
            createdAt: now,
            updatedAt: now
        };

        if (data.email) persona.email = data.email;
        if (data.tieneAccesoWeb) persona.passwordHash = hashPassword(tempPassword, personaId);

        await docClient.send(new PutCommand({ TableName: PERSONAS_TABLE, Item: persona }));

        const acceso = data.tieneAccesoWeb ? `(pass: ${tempPassword})` : '(solo app movil)';
        console.log(`  Persona: ${data.nombre} ${data.apellido} [${data.rol}] ${acceso}`);
    }

    console.log('\n--- Resumen ---');
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`Obra ID:   ${obraId}`);
    console.log(`Personas:  ${personasData.length}`);
    console.log('\nUsa este tenantId en los query params para probar los endpoints.');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
