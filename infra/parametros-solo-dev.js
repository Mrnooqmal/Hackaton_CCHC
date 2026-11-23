#!/usr/bin/env node
const PREVIOS = ['NombreBucket', 'Csp', 'CspModo', 'ReportingEndpoints', 'CertificadoProd', 'Publicadores', 'ExigirRolPublicador', 'NombreBucketDev'];

function parametros({ cspDev, reporteDev, certificadoDev }) {
    if (!cspDev) throw new Error('Falta la CSP de dev.');
    if (!reporteDev) throw new Error('Falta la URL de reportes de dev.');
    return [
        ...PREVIOS.map((clave) => ({ ParameterKey: clave, UsePreviousValue: true })),
        { ParameterKey: 'CspDev', ParameterValue: cspDev },
        { ParameterKey: 'ReportingEndpointsDev', ParameterValue: `csp="${reporteDev}/csp/reporte"` },
        { ParameterKey: 'CertificadoDev', ParameterValue: certificadoDev || '' },
    ];
}

if (require.main === module) {
    try {
        process.stdout.write(JSON.stringify(parametros({
            cspDev: process.env.CSP_DEV, reporteDev: process.env.REPORTE_DEV, certificadoDev: process.env.CERT_DEV,
        }), null, 2));
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}

module.exports = { parametros, PREVIOS };
