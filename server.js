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
        // Recibimos datos enriquecidos para que la IA diseñe páginas verdaderamente profesionales
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

        // Prompt estructurado de nivel Senior UI/UX para diseños dinámicos y profesionales
        const systemPrompt = `
        Eres un diseñador UX/UI de clase mundial y un desarrollador Frontend experto en Tailwind CSS, animaciones web y diseño de alta conversión.
        Tu trabajo es generar una Landing Page absolutamente HERMOSA, MODERNA, ÚNICA y PROFESIONAL en un único archivo HTML completo.
        
        REGLAS DE DISEÑO OBLIGATORIAS:
        1. Devuelve ÚNICAMENTE código HTML puro (empezando por <!DOCTYPE html> y terminando en </html>). NADA de texto adicional, explicaciones ni bloques de markdown.
        2. **Estética y Estilo:** Utiliza paletas de colores modernos (fondos oscuros elegantes con gradientes vibrantes en indigo/cyan/emerald, o estilos limpios y minimalistas según se pida), bordes sutiles con opacidad y efectos de cristal (backdrop-blur-md).
        3. **Animaciones y Transiciones:** Implementa animaciones fluidas con clases de Tailwind (ej. hover:-translate-y-2, transition-all duration-300, shadow-2xl, hover:shadow-indigo-500/20, efectos de escala y botones interactivos).
        4. **Estructura Completa:** La página DEBE incluir obligatoriamente:
           - Navbar fija superior con efecto glassmorphism, logotipo/nombre y botón de contacto.
           - Sección Hero impactante con tipografía de alto impacto, subtítulo persuasivo, llamados a la acción (CTA) destacados.
           - Sección de Beneficios / Características con tarjetas interactivas e iconos profesionales (puedes usar FontAwesome).
           - Sección de Productos / Servicios (si se proporcionan, móstralos en cuadrículas modernas con imágenes ilustrativas de Unsplash de alta calidad acordes al nicho).
           - Sección de Testimonios de clientes satisfechos.
           - Banner final de llamado a la acción masivo.
           - Footer profesional.
        5. **Interactividad WhatsApp:** Todos los botones de llamada a la acción deben redirigir obligatoriamente a: https://wa.me/${cleanWhatsapp}?text=Hola,%20me%20interesa%20obtener%20más%20información%20sobre%20sus%20servicios.
        `;

        const userPrompt = `
        Crea una landing page única y deslumbrante para el siguiente negocio:
        - Nombre: "${business}"
        - Eslogan / Propuesta: "${tagline || description || 'La mejor solución para ti'}"
        - Logotipo (URL opcional): "${logoUrl || ''}"
        - Productos o Servicios clave: "${products || 'Servicios profesionales personalizados'}"
        - Estilo visual deseado: "${style || 'Moderna, minimalista y de alto impacto con animaciones fluidas'}"
        - Número de WhatsApp: "${cleanWhatsapp}"
        `;

        let htmlContent = '';
        
        try {
            const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022', // Claude 3.5 Sonnet para resultados estéticos superiores en frontend
                    max_tokens: 8192,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.9
                })
            });

            const aiData = await aiResponse.json();

            if (aiData.error) {
                throw new Error(aiData.error.message || 'Error en la API de Anthropic');
            }

            htmlContent = aiData.content[0].text.trim();
            
            // Limpieza de seguridad por si la IA incluye bloques markdown
            htmlContent = htmlContent.replace(/^```html\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

        } catch (aiError) {
            console.error("Error generando con Claude, usando fallback:", aiError);
            htmlContent = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${business}</title><script src="[https://cdn.tailwindcss.com](https://cdn.tailwindcss.com)"></script></head><body class="bg-slate-950 text-white flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-4xl font-bold mb-4">${business}</h1><a href="[https://wa.me/$](https://wa.me/$){cleanWhatsapp}" class="bg-emerald-600 px-8 py-4 rounded-xl font-bold shadow-lg">Contactar por WhatsApp</a></div></body></html>`;
        }

        const landingUrl = `https://${MAIN_DOMAIN}/s/${landingId}`;
        const landingInfo = { landingId, business, url: landingUrl, createdAt: new Date().toISOString() };

        // Guardar en Cloudflare KV
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
