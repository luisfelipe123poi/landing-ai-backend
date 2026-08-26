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

// AUMENTO DE LÍMITE DE TAMAÑO PARA EVITAR ERROR 413 EN IMÁGENES/HTML PESADO
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

async function kvDelete(key) {
    if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) return false;
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
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
        default: return 200;
    }
}

// ================= REPOSITORIO DE PLANTILLAS ESTÁTICAS =================
const STATIC_TEMPLATES = {
    cafe: `<!DOCTYPE html>
<html lang="es" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{BUSINESS_NAME}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; }
    </style>
</head>
<body class="bg-[#150f0d] text-[#f9f6f0] font-sans selection:bg-[#c88a53] selection:text-white antialiased min-h-screen relative pb-20">
    <header class="sticky top-0 left-0 w-full z-40 bg-[#150f0d]/85 backdrop-blur-md border-b border-[#33241f]/60">
        <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-[#c88a53] to-[#8c5225] flex items-center justify-center shadow-lg">
                    <i class="fa-solid fa-mug-hot text-white text-lg"></i>
                </div>
                <span class="font-serif text-2xl font-bold tracking-wide text-[#f9f6f0]">Café <span class="text-[#dfb17b] italic font-normal">{{BUSINESS_NAME}}</span></span>
            </div>
            <a href="https://wa.me/{{WHATSAPP}}?text=Hola,%20quiero%20hacer%20un%20pedido" target="_blank" class="bg-gradient-to-r from-[#c88a53] to-[#ad6d38] text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-xl flex items-center gap-2.5 hover:opacity-90 transition">
                <i class="fa-brands fa-whatsapp text-base"></i>
                <span>Pedir por WhatsApp</span>
            </a>
        </div>
    </header>
    <main class="relative min-h-[80vh] flex items-center justify-center pt-16 pb-16 overflow-hidden bg-gradient-to-b from-[#150f0d] via-[#1d1411] to-[#150f0d]">
        <div class="max-w-7xl mx-auto px-6 w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative z-10">
            <div class="lg:col-span-7 space-y-6 text-center lg:text-left">
                <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#33241f]/80 border border-[#c88a53]/30 text-[#dfb17b] text-xs font-semibold tracking-wider uppercase backdrop-blur-sm">
                    <i class="fa-solid fa-location-dot"></i> <span>{{TAGLINE}}</span>
                </div>
                <h1 class="text-4xl sm:text-6xl lg:text-7xl font-serif font-bold tracking-tight leading-[1.1]">
                    <span>Tradición y el alma del</span> 
                    <span class="text-transparent bg-clip-text bg-gradient-to-r from-[#dfb17b] via-[#c88a53] to-[#b3723b] italic">café de origen</span>
                </h1>
                <p class="text-lg text-[#f9f6f0]/70 max-w-2xl mx-auto lg:mx-0 font-light leading-relaxed">
                    {{DESCRIPTION}}
                </p>
                <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
                    <a href="https://wa.me/{{WHATSAPP}}?text=Hola,%20quiero%20hacer%20un%20pedido" target="_blank" class="w-full sm:w-auto bg-gradient-to-r from-[#c88a53] to-[#9e5d2b] text-white px-8 py-4 rounded-full font-bold text-base shadow-2xl flex items-center justify-center gap-3 hover:opacity-90 transition">
                        <span>Ver Menú por WhatsApp</span>
                        <i class="fa-solid fa-arrow-right"></i>
                    </a>
                </div>
            </div>
            <div class="lg:col-span-5 relative">
                <div class="rounded-3xl overflow-hidden border border-[#4a342e] shadow-2xl bg-[#221915] relative h-[460px]">
                    <img src="https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1000&q=80" alt="Café Macondo Barista" class="w-full h-full object-cover">
                </div>
            </div>
        </div>
    </main>
    <footer class="py-12 bg-[#0f0a08] border-t border-[#33241f] text-center text-xs text-[#f9f6f0]/50 space-y-2">
        <p>{{BUSINESS_NAME}} • Todos los derechos reservados © 2026</p>
    </footer>
</body>
</html>`
};

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
        const { templateName, business, tagline, description, whatsapp } = req.body;
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

        let templateHtml = STATIC_TEMPLATES[templateName] || STATIC_TEMPLATES['cafe'];
        const cleanWhatsapp = whatsapp ? whatsapp.replace(/[^0-9]/g, '') : '';

        let htmlContent = templateHtml
            .replace(/\{\{BUSINESS_NAME\}\}/g, business || 'Mi Negocio')
            .replace(/\{\{TAGLINE\}\}/g, tagline || 'Tu mejor opción')
            .replace(/\{\{DESCRIPTION\}\}/g, description || 'Servicios profesionales adaptados a lo que necesitas.')
            .replace(/\{\{WHATSAPP\}\}/g, cleanWhatsapp);

        const landingId = Math.random().toString(36).substring(2, 9);
        const landingUrl = `https://${MAIN_DOMAIN}/s/${landingId}`;
        const landingInfo = { id: landingId, landingId, business, url: landingUrl, createdAt: new Date().toISOString() };

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

// ENDPOINT PARA GUARDAR LANDING EDITADA EN VIVO (Con soporte hasta 50MB por imágenes en base64 y control de tokens)
app.post('/api/save-custom-landing', async (req, res) => {
    try {
        const { business, htmlContent } = req.body;
        const authHeader = req.headers.authorization;

        if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const userKey = `user_${decoded.email}`;
        let user = await kvGet(userKey);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (user.tokens !== undefined && user.tokens <= 0) {
            return res.status(403).json({ error: 'Has alcanzado el límite de tu plan. Actualiza tu membresía para crear o guardar más páginas.' });
        }

        const landingId = Math.random().toString(36).substring(2, 9);
        const landingUrl = `https://${MAIN_DOMAIN}/s/${landingId}`;
        const landingInfo = { id: landingId, landingId, business: business || 'Mi Negocio', url: landingUrl, createdAt: new Date().toISOString() };

        await kvPut(`landing_${landingId}`, { userEmail: decoded.email, business: landingInfo.business, htmlContent });

        if (user.tokens > 0 && user.tokens < 999999) {
            user.tokens -= 1;
        }
        if (!user.landings) user.landings = [];
        user.landings.push(landingInfo);
        await kvPut(userKey, user);

        res.json({ success: true, landingId, url: landingUrl, remainingTokens: user.tokens });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar la página' });
    }
});

// ENDPOINTS DE OBTENCIÓN DE LANDINGS (Soporta /api/landings y /api/my-landings)
const handleGetLandings = async (req, res) => {
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
};

app.get('/api/landings', handleGetLandings);
app.get('/api/my-landings', handleGetLandings);

app.get('/api/preview/:landingId', async (req, res) => {
    try {
        const { landingId } = req.params;
        
        const landingData = await kvGet(`landing_${landingId}`);
        if (!landingData || !landingData.htmlContent) {
            return res.status(404).send('Landing no encontrada');
        }
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(landingData.htmlContent);
    } catch (error) {
        res.status(500).send('Error al previsualizar');
    }
});

// ENDPOINT PARA ELIMINAR UNA LANDING
app.delete('/api/landings/:landingId', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { landingId } = req.params;
        const userKey = `user_${decoded.email}`;
        let user = await kvGet(userKey);

        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        user.landings = (user.landings || []).filter(l => (l.landingId !== landingId && l.id !== landingId));
        await kvPut(userKey, user);

        await kvDelete(`landing_${landingId}`);

        res.json({ success: true, message: 'Landing eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar la landing' });
    }
});

// ================= RUTA PÚBLICA PARA SERVIR LA LANDING ESTÁTICA =================
app.get('/s/:landingId', async (req, res) => {
    try {
        const { landingId } = req.params;
        const landingData = await kvGet(`landing_${landingId}`);

        if (!landingData || !landingData.htmlContent) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Página no encontrada</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-slate-950 text-white flex items-center justify-center h-screen">
                    <div class="text-center space-y-3">
                        <h1 class="text-4xl font-bold">404</h1>
                        <p class="text-slate-400">La página web que buscas no existe o fue eliminada.</p>
                    </div>
                </body>
                </html>
            `);
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(landingData.htmlContent);
    } catch (error) {
        res.status(500).send('Error interno del servidor al cargar la página');
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
