const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro';

// Definición de tu subdominio dedicado para las landings
const MAIN_DOMAIN = 'landinggen.prestigecloser.com';

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

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

// Función auxiliar para definir tokens iniciales según el plan
function getTokensForPlan(plan) {
    switch (plan) {
        case 'starter': return 3;
        case 'pro':
        case 'business': return 999999; // Ilimitados
        case 'free':
        default: return 20;
    }
}

app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

        const existingUser = await kvGet(`user_${email}`);
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const plan = 'free';
        const userData = { 
            passwordHash: hashedPassword, 
            plan: plan,
            tokens: getTokensForPlan(plan),
            landings: [] 
        };

        await kvPut(`user_${email}`, userData);

        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, plan, tokens: userData.tokens });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await kvGet(`user_${email}`);

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            success: true, 
            token, 
            plan: user.plan || 'free', 
            tokens: user.tokens ?? getTokensForPlan(user.plan || 'free') 
        });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Asegúrate de tener instalado el cliente (ej. npm install openai) o usar fetch nativo hacia la API de OpenAI / Anthropic
app.post('/api/generate', async (req, res) => {
    try {
        const { business, whatsapp, style, description } = req.body; // Puedes pedir opcionalmente una breve descripción del negocio
        const authHeader = req.headers.authorization;

        if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const userKey = `user_${decoded.email}`;
        let user = await kvGet(userKey);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (user.tokens !== undefined && user.tokens <= 0) {
            return res.status(403).json({ error: 'No tienes tokens disponibles. Actualiza tu plan.' });
        }

        const landingId = Math.random().toString(36).substring(2, 9);
        const cleanWhatsapp = whatsapp ? whatsapp.replace(/[^0-9]/g, '') : '';

        // ==========================================
        // GENERACIÓN DINÁMICA CON INTELIGENCIA ARTIFICIAL
        // ==========================================
        let htmlContent = '';
        
        try {
            const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini', // O el modelo que prefieras
                    messages: [
                        {
                            role: 'system',
                            content: `Eres un diseñador web experto y desarrollador frontend especializado en Tailwind CSS. Tu objetivo es crear una landing page moderna, única, hermosa, responsiva y de alta conversión en un solo archivo HTML completo. 
                            REGLAS ESTRICTAS:
                            - Devuelve ÚNICAMENTE el código HTML válido (empezando por <!DOCTYPE html> y terminando en </html>), sin texto adicional ni bloques de Markdown tipo \`\`\`html.
                            - Varía el diseño, los colores de fondo, la tipografía y la estructura según el estilo solicitado para que nunca se repita el mismo diseño.
                            - Incluye Tailwind CSS mediante CDN (<script src="https://cdn.tailwindcss.com"></script>) y FontAwesome para iconos.
                            - Usa el número de WhatsApp proporcionado para los botones de contacto con el formato https://wa.me/NUMERO.`
                        },
                        {
                            role: 'user',
                            content: `Crea una landing page moderna y única para un negocio llamado "${business}". El estilo visual debe ser: "${style || 'moderno y minimalista'}". El número de WhatsApp para los botones de contacto es "${cleanWhatsapp}".`
                        }
                    ],
                    temperature: 0.9 // Temperatura alta para garantizar creatividad y diseños diferentes cada vez
                })
            });

            const aiData = await aiResponse.json();
            htmlContent = aiData.choices[0].message.content.trim();
            
            // Limpieza por si la IA devuelve bloques de código con markdown
            htmlContent = htmlContent.replace(/^```html\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

        } catch (aiError) {
            console.error("Error generando con IA, usando fallback:", aiError);
            // Fallback de emergencia por si falla la API de IA
            htmlContent = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${business}</title><script src="[https://cdn.tailwindcss.com](https://cdn.tailwindcss.com)"></script></head><body class="bg-slate-900 text-white flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-3xl font-bold mb-4">${business}</h1><a href="[https://wa.me/$](https://wa.me/$){cleanWhatsapp}" class="bg-green-500 px-6 py-3 rounded-xl font-bold">Contactar por WhatsApp</a></div></body></html>`;
        }

        const landingUrl = `https://${MAIN_DOMAIN}/s/${landingId}`;
        const landingInfo = { landingId, business, url: landingUrl, createdAt: new Date().toISOString() };

        // Guardar en KV
        await kvPut(`landing_${landingId}`, { userEmail: decoded.email, business, htmlContent });

        // Descontar token y guardar
        if (user.tokens > 0 && user.tokens < 999999) {
            user.tokens -= 1;
        }
        if (!user.landings) user.landings = [];
        user.landings.push(landingInfo);
        await kvPut(userKey, user);

        res.json({ success: true, landingId, url: landingUrl, remainingTokens: user.tokens });
    } catch (error) {
        res.status(500).json({ error: 'Error al generar la landing' });
    }
});

// Endpoint para que el frontend liste las páginas del usuario
app.get('/api/my-landings', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = await kvGet(`user_${decoded.email}`);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        res.json({ success: true, landings: user.landings || [] });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las landings' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
