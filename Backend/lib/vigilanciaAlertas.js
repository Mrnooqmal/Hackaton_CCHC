const { SNSClient, GetTopicAttributesCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({});

async function revisarSuscriptoresAlertas({ cliente = sns, enviar = (m) => require('./correo').enviarCorreo(m) } = {}) {
    const topico = process.env.ALERTAS_TOPIC_ARN;
    const para = process.env.DESTINATARIO_ALERTAS;
    if (!topico || !para) throw new Error('Faltan ALERTAS_TOPIC_ARN o DESTINATARIO_ALERTAS: no se puede vigilar el tópico de alarmas.');
    const stage = process.env.STAGE || process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-')[1] || 'desconocido';

    const { Attributes = {} } = await cliente.send(new GetTopicAttributesCommand({ TopicArn: topico }));
    const confirmadas = Number(Attributes.SubscriptionsConfirmed || 0);
    const pendientes = Number(Attributes.SubscriptionsPending || 0);
    if (confirmadas >= 1) return { confirmadas, pendientes, avisado: false };

    console.error(`[alarmas] ${stage}: el tópico ${topico} no tiene suscripciones confirmadas (pendientes: ${pendientes})`);
    const r = await enviar({
        para,
        asunto: `[Build & Serve ${stage}] Las alarmas no le llegan a nadie`,
        texto: [
            `El tópico de alarmas de ${stage} no tiene ninguna suscripción confirmada (pendientes: ${pendientes}).`,
            `Tópico: ${topico}`,
            '',
            'Mientras esto siga así, ninguna alarma de operación avisa. Para volver a suscribir la casilla:',
            `  aws sns subscribe --topic-arn ${topico} --protocol email --notification-endpoint ${para}`,
            'y confirma con: aws sns confirm-subscription --topic-arn <tópico> --token <token del correo> --authenticate-on-unsubscribe true',
            '',
            'Este aviso sale todos los días a las 13:00 UTC hasta que haya una suscripción confirmada.',
        ].join('\n'),
    });
    return { confirmadas, pendientes, avisado: r.enviado === true, ...(r.suprimida ? { suprimida: r.suprimida } : {}) };
}

module.exports = { revisarSuscriptoresAlertas };
