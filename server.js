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

app.post('/api/generate', async (req, res) => {
    try {
        const { business, tagline, logoUrl, products, whatsapp, style, description } = req.body;
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

        // System prompt ultra-optimizado para extraer creatividad visual de OpenAI
        const systemPrompt = `
        Eres un diseñador UX/UI de élite mundial y un desarrollador Frontend Senior experto en Tailwind CSS. Tu objetivo es crear Landing Pages artesanales, impactantes y de categoría mundial (estilo agencias como Vercel, Apple o Stripe), exactamente con la misma profundidad, elegancia y riqueza visual que el siguiente estándar de referencia:
        
        EJEMPLO DE CALIDAD ESPERADA (ESTRUCTURA Y ESTÉTICA OBLIGATORIA):
        - Uso obligatorio de fuentes de Google Fonts importadas ('Playfair Display', 'Plus Jakarta Sans', etc.) mediante enlaces CDN.
        - Fondos oscuros profundos y sofisticados combinados con gradientes sutiles y bordes con opacidad (ej. border border-white/10 o tonos tierra profundos como #150f0d con acentos dorados/ámbar).
        - Navbar fija con efecto backdrop-blur, logotipo estilizado con icono de FontAwesome (ej. <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">).
        - Sección Hero imponente con tipografía grande (font-serif font-bold), subtítulos descriptivos, insignias o badges superiores con bordes sutiles, y botones con efectos de sombra y transición (shadow-2xl, hover:-translate-y-0.5).
        - Secciones secundarias muy cuidadas: Origen/Filosofía con grillas asimétricas de imágenes de Unsplash, tarjetas de productos/servicios con efectos de hover (group-hover:scale-105 transition duration-700), insignias de "Destacado" o "Más popular", y botones de WhatsApp directos y estilizados.
        - Sección de Testimonios impecable en tarjetas separadas con valoraciones en estrellas.
        - Banner de llamada a la acción (CTA) masivo y Footer profesional completo.

        REGLAS TÉCNICAS INQUEBRANTABLES:
        1. Devuelve ÚNICAMENTE código HTML puro, empezando por <!DOCTYPE html> y terminando en </html>. NADA de texto adicional, explicaciones ni bloques de markdown.
        2. Los botones de contacto por WhatsApp deben usar estrictamente la URL con este formato exacto: https://wa.me/${cleanWhatsapp}?text=Hola,%20me%20interesa%20obtener%20más%20información.
        3. Nunca dejes secciones vacías ni textos genéricos de relleno ("Lorem ipsum"). Todo el contenido textual debe sonar altamente persuasivo, comercial y adaptado al negocio del usuario.
        `;

        const userPrompt = `
        Crea una landing page única, orgánica y deslumbrante para el siguiente negocio:
        - Nombre: "${business}"
        - Eslogan / Propuesta: "${tagline || description || 'La mejor solución para ti'}"
        - Logotipo (URL opcional): "${logoUrl || ''}"
        - Productos o Servicios clave: "${products || 'Servicios profesionales personalizados'}"
        - Estilo visual deseado: "${style || 'Moderna, minimalista y de alto impacto con animaciones fluidas'}"
        - Número de WhatsApp: "${cleanWhatsapp}"
        `;

        let htmlContent = '';
        
        try {
            const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.95 // Subimos un poco más la temperatura para exprimir la creatividad de OpenAI
                })
            });

            const aiData = await aiResponse.json();
            
            if (aiData.error) {
                throw new Error(aiData.error.message || 'Error en la API de OpenAI');
            }

            htmlContent = aiData.choices[0].message.content.trim();
            htmlContent = htmlContent.replace(/^```html\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

        } catch (aiError) {
            console.error("Error generando con OpenAI, usando fallback:", aiError);
            htmlContent = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${business}</title><script src="[https://cdn.tailwindcss.com](https://cdn.tailwindcss.com)"></script></head><body class="bg-slate-950 text-white flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-4xl font-bold mb-4">${business}</h1><a href="[https://wa.me/$](https://wa.me/$){cleanWhatsapp}" class="bg-emerald-600 px-8 py-4 rounded-xl font-bold shadow-lg">Contactar por WhatsApp</a></div></body></html>`;
        }

        const landingUrl = `https://${MAIN_DOMAIN}/s/${landingId}`;
        const landingInfo = { landingId, business, url: landingUrl, createdAt: new Date().toISOString() };

        await kvPut(`landing_${landingId}`, { userEmail: decoded.email, business, htmlContent });

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
