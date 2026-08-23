const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro';

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Credenciales de Cloudflare KV desde las variables de entorno de Render
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

// Funciones auxiliares para interactuar con Cloudflare KV vía API REST
async function kvGet(key) {
    if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) return null;
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`, {
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function kvPut(key, value) {
    if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) return false;
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${CF_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(value)
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

// ================= RUTAS DE AUTENTICACIÓN =================

// Registro
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

        // Verificar si el usuario ya existe en KV
        const existingUser = await kvGet(`user_${email}`);
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userData = { passwordHash: hashedPassword, plan: 'free' };

        // Guardar en Cloudflare KV
        await kvPut(`user_${email}`, userData);

        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, plan: 'free' });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await kvGet(`user_${email}`);

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, plan: user.plan });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// ================= RUTA DE GENERACIÓN CON IA =================

app.post('/api/generate', async (req, res) => {
    try {
        const { business, whatsapp, style } = req.body;
        const authHeader = req.headers.authorization;

        if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const landingId = Math.random().toString(36).substring(2, 9);
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${business}</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-slate-900 text-white font-sans flex flex-col items-center justify-center min-h-screen p-6 text-center">
                <h1 class="text-4xl font-black mb-4">${business}</h1>
                <p class="text-slate-300 mb-8 max-w-md">Bienvenido a nuestra página oficial. Contáctanos de inmediato para agendar tu pedido o servicio.</p>
                <a href="https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}" class="px-8 py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-2xl shadow-xl transition">
                    💬 Chatear por WhatsApp
                </a>
            </body>
            </html>
        `;

        // Guardar la landing en Cloudflare KV
        await kvPut(`landing_${landingId}`, { userEmail: decoded.email, business, htmlContent });

        res.json({ success: true, landingId, url: `/s/${landingId}` });
    } catch (error) {
        res.status(500).json({ error: 'Error al generar la landing' });
    }
});

// Ruta pública para servir la landing creada desde KV
app.get('/s/:id', async (req, res) => {
    const landing = await kvGet(`landing_${req.params.id}`);
    if (!landing) return res.status(404).send('Página no encontrada');
    res.send(landing.htmlContent);
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
