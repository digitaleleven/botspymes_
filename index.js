const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
const express = require('express');
require('dotenv').config();

const cliente = require('./cliente.json');

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log(`✅ ¡Bot de ${cliente.nombre_empresa} conectado con éxito!`);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const textMessage = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || 
                            msg.message.imageMessage?.caption || '';

        console.log(`Mensaje recibido de ${from}: ${textMessage}`);

        try {
            const promptSistema = `
Eres el asistente virtual de urgencias 24h para "${cliente.nombre_empresa}".
Sector: ${cliente.sector}.
Dirección de la Clínica Veterinaria: ${cliente.direccion_clinica_vet}.
Tarifas: ${JSON.stringify(cliente.tarifas)}.

REGLAS DE RESPUESTA:
1. Si la urgencia es de VETERINARIA: No pidas la ubicación del cliente. Indícale la dirección de la clínica (${cliente.direccion_clinica_vet}), pregúntale los síntomas de la mascota y si puede acudir de inmediato.
2. Si la urgencia es de CERRAJERÍA o FONTANERÍA: Solicita la dirección del cliente para enviar un técnico.
3. Si el usuario pide que LE LLAMEN o pide una LLAMADA: Explícale amablemente que has pasado un aviso prioritario a nuestro equipo de guardia para que le devuelvan la llamada de inmediato.
4. Sé directo, breve (máximo 2-3 frases) y muy profesional.
`;

            const gptResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: promptSistema },
                    { role: 'user', content: textMessage }
                ],
                max_tokens: 150
            });

            const replyText = gptResponse.choices[0].message.content;
            await sock.sendMessage(from, { text: replyText });

            // Lógica de Alerta: Si pide llamada o hay urgencia crítica, registramos el aviso
            const textoMinus = textMessage.toLowerCase();
            if (textoMinus.includes('llama') || textoMinus.includes('lláma') || textoMinus.includes('telefono') || textoMinus.includes('teléfono')) {
                console.log(`🚨 [ALERTA DE LLAMADA] El cliente ${from} solicita llamada telefónica urgente.`);
                // Aquí en DigitalOcean vincularemos un envío automático de SMS/WhatsApp al móvil del dueño.
            }

        } catch (error) {
            console.error('Error procesando OpenAI:', error);
        }
    });
}

connectToWhatsApp();

app.listen(3000, () => {
    console.log('Servidor HTTP escuchando en el puerto 3000');
});
