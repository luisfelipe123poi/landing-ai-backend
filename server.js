const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MercadoPagoConfig, Preference } = require('mercadopago');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro';

// Definición de tu subdominio dedicado para las landings
const MAIN_DOMAIN = 'landinggen.prestigecloser.com';

// ================= CONFIGURACIÓN DE MERCADO PAGO =================
const mpClient = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || 'TU_ACCESS_TOKEN_PRODUCCION_O_SANDBOX' 
});

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// AUMENTO DE LÍMITE DE TAMAÑO PARA EVITAR ERROR 413 EN IMÁGENES/HTML PESADO
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ================= CONEXIÓN A MONGODB =================
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Conectado exitosamente a MongoDB'))
.catch(err => console.error('Error de conexión a MongoDB:', err));

// ================= ESQUEMAS DE MONGOOSE =================
const landingSchema = new mongoose.Schema({
    landingId: { type: String, required: true, unique: true },
    userEmail: { type: String, required: true },
    business: { type: String },
    templateKey: { type: String }, // <--- Almacena la plantilla exacta
    htmlContent: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    plan: { type: String, default: 'free' },
    tokens: { type: Number, default: 200 },
    landings: [{
        landingId: String,
        business: String,
        templateKey: String, // <--- Acceso rápido a la plantilla en el panel
        url: String,
        createdAt: String
    }],
    unlockedPlatinumTemplates: { type: [String], default: [] },
    activeExclusiveRentals: [String]
});

const Landing = mongoose.model('Landing', landingSchema);
const User = mongoose.model('User', userSchema);

// Función auxiliar para definir tokens iniciales según el plan
function getTokensForPlan(plan) {
    switch (plan) {
        case 'starter': return 3;
        case 'pro':
        case 'business':
        case 'agency_platinum': return 999999; // Ilimitados
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
                    <img src="https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1000&q=80" alt="Café Barista" class="w-full h-full object-cover">
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

// ================= MIDDLEWARES DE AUTENTICACIÓN =================
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
 
    if (!token) {
        return res.status(401).json({ error: 'Token de autenticación faltante' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado' });
        }
        req.user = user;
        next();
    });
}

// ================= ENDPOINTS DE AUTENTICACIÓN =================
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

        const cleanEmail = email.trim().toLowerCase();
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const plan = 'free';
        const newUser = new User({
            email: cleanEmail,
            passwordHash: hashedPassword,
            plan,
            tokens: getTokensForPlan(plan),
            landings: [],
            unlockedPlatinumTemplates: [],
            activeExclusiveRentals: []
        });

        await newUser.save();

        const token = jwt.sign({ email: cleanEmail }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, plan, tokens: newUser.tokens });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const cleanEmail = (email || '').trim().toLowerCase();
        const user = await User.findOne({ email: cleanEmail });

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign({ email: cleanEmail }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            success: true, 
            token, 
            plan: user.plan || 'free', 
            tokens: user.tokens ?? getTokensForPlan(user.plan || 'free'),
            unlockedPlatinumTemplates: user.unlockedPlatinumTemplates || []
        });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// ================= ENDPOINTS DE MERCADO PAGO =================
const axios = require('axios');

app.post('/api/create-preference', verifyToken, async (req, res) => {
    console.log("--- RECIBIDA PETICIÓN /api/create-preference (TRM Dinámica) ---");
    console.log("Body recibido:", req.body);

    try {
        const { planName, email } = req.body;
        
        const emailCliente = (email || req.user?.email || "").trim().toLowerCase();
        if (!emailCliente) {
            return res.status(400).json({ error: "El correo electrónico es requerido para procesar el pago." });
        }

        const planRaw = (planName || "pro").toLowerCase().trim();

        // Estructura oficial de precios y límites de páginas (tokens) exactos
        const preciosUSD = {
            "pro": { nombre: "Plan Pro Negocios", precioUSD: 10, tokens: 5 },
            "agency_platinum": { nombre: "Plan Agencia Platinum", precioUSD: 25, tokens: 10 }
        };

        let infoPlan;
        let planId = planRaw;

        // Validar si es una compra de Plantilla Exclusiva Platinum (soporta 'platinum_template_' o 'platinum_')
        if (planRaw.startsWith('platinum_template_') || planRaw.startsWith('platinum_')) {
            const templateKey = planRaw
                .replace('platinum_template_', '')
                .replace('platinum_', '');
            
            // 1. VALIDACIÓN DE EXCLUSIVIDAD GLOBAL PREVIA (Backend Checkout)
            const alreadyTaken = await User.findOne({
                email: { $ne: emailCliente },
                unlockedPlatinumTemplates: templateKey
            });

            if (alreadyTaken) {
                return res.status(400).json({ 
                    error: 'Lo sentimos, esta plantilla exclusiva ya fue alquilada por otro usuario y ya no está disponible.' 
                });
            }

            // Verificar si el usuario actual ya la posee
            const currentUser = await User.findOne({ email: emailCliente });
            if (currentUser && currentUser.unlockedPlatinumTemplates && currentUser.unlockedPlatinumTemplates.includes(templateKey)) {
                return res.status(400).json({ error: 'Ya tienes desbloqueada esta plantilla exclusiva.' });
            }

            infoPlan = {
                nombre: `Alquiler Plantilla Platinum (${templateKey})`,
                precioUSD: 25, // Fijo en 25 USD mensuales
                tokens: 0 
            };

            // Aseguramos que el planId enviado a external_reference mantenga el formato correcto para el webhook
            planId = `platinum_template_${templateKey}`;
        } else if (preciosUSD[planRaw]) {
            infoPlan = preciosUSD[planRaw];
        } else {
            planId = "pro";
            infoPlan = preciosUSD["pro"];
        }

        let tasaCambio = 4000;
        try {
            const responseTasa = await axios.get('https://open.er-api.com/v6/latest/USD');
            if (responseTasa.data && responseTasa.data.rates && responseTasa.data.rates.COP) {
                tasaCambio = responseTasa.data.rates.COP;
            }
        } catch (errTasa) {
            console.warn("No se pudo obtener la tasa en tiempo real, usando respaldo:", tasaCambio);
        }

        const precioEnMonedaLocal = Math.round(infoPlan.precioUSD * tasaCambio);

        console.log(`Conversión aplicada -> USD: $${infoPlan.precioUSD} | Tasa TRM: ${tasaCambio} | Total COP: $${precioEnMonedaLocal}`);

        const preferenceData = {
            body: {
                items: [
                    {
                        title: `LandingGen - ${infoPlan.nombre} ($${infoPlan.precioUSD} USD)`,
                        quantity: 1,
                        currency_id: 'COP',
                        unit_price: Number(precioEnMonedaLocal)
                    }
                ],
                payer: { email: emailCliente },
                back_urls: {
                    success: 'https://landinggen.prestigecloser.com/?status=success',
                    failure: 'https://landinggen.prestigecloser.com/?status=failure',
                    pending: 'https://landinggen.prestigecloser.com/?status=pending'
                },
                auto_return: 'approved',
                notification_url: 'https://landing-ai-backend.onrender.com/api/webhook-mercadopago',
                statement_descriptor: 'LANDINGGEN',
                external_reference: `${emailCliente}|${planId}`
            }
        };

        const preference = new Preference(mpClient);
        const result = await preference.create(preferenceData);

        const initPoint = result.init_point || result.sandbox_init_point;
        
        if (!initPoint) {
            console.error("Error MercadoPago Response:", result);
            return res.status(400).json({ error: "Mercado Pago rechazó la preferencia." });
        }

        res.json({ 
            success: true, 
            init_point: initPoint, 
            id: result.id 
        });

    } catch (error) {
        console.error('Exception en crear_preferencia_pago:', error);
        res.status(500).json({ error: error.message || 'Error interno procesando el pago' });
    }
});

// =========================================================================
// Webhook de Mercado Pago (Actualizado con control de vigencia a 30 días)
// =========================================================================
app.post('/api/webhook-mercadopago', async (req, res) => {
    try {
        const body = req.body;
        
        if (body.type === 'payment' || body.topic === 'payment') {
            const paymentId = body.data?.id || body.id;
            
            if (paymentId) {
                const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                    headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
                });
                
                const payment = await response.json();

                if (payment && payment.status === 'approved') {
                    let payerEmail = payment.payer?.email;
                    const extRef = payment.external_reference || "";
                    let planDesdeRef = "pro";

                    if (extRef.includes("|")) {
                        const parts = extRef.split("|");
                        if (!payerEmail) payerEmail = parts[0];
                        planDesdeRef = parts[1];
                    } else if (!payerEmail) {
                        payerEmail = extRef;
                    }

                    if (payerEmail) {
                        payerEmail = payerEmail.trim().toLowerCase();
                        
                        const user = await User.findOne({ email: payerEmail });
                        if (user) {
                            // Verificamos si el pago corresponde a una plantilla Platinum (soporta ambos prefijos)
                            const isPlatinumPayment = planDesdeRef.startsWith('platinum_template_') || planDesdeRef.startsWith('platinum_');

                            if (isPlatinumPayment) {
                                // Extraer la clave limpia de la plantilla sin importar el prefijo
                                const templateKey = planDesdeRef
                                    .replace('platinum_template_', '')
                                    .replace('platinum_', '');
                                
                                // VALIDACIÓN DE EXCLUSIVIDAD GLOBAL EN MONGODB:
                                // Verifica si cualquier otro usuario ya registró esta plantilla exclusiva
                                const alreadyClaimed = await User.findOne({
                                    _id: { $ne: user._id },
                                    unlockedPlatinumTemplates: templateKey
                                });

                                if (alreadyClaimed) {
                                    console.warn(`[EXCLUSIVIDAD VIOLADA] La plantilla ${templateKey} ya fue alquilada previamente por otro usuario (${alreadyClaimed.email}). No se asignó a ${payerEmail}.`);
                                } else {
                                    // Calcular fecha de expiración exacta (30 días de vigencia)
                                    const expirationDate = new Date();
                                    expirationDate.setDate(expirationDate.getDate() + 30);

                                    // Aseguramos que existan los objetos en el esquema si no están inicializados
                                    if (!user.unlockedPlatinumTemplates) user.unlockedPlatinumTemplates = [];
                                    if (!user.subscriptions) user.subscriptions = {};

                                    if (!user.unlockedPlatinumTemplates.includes(templateKey)) {
                                        user.unlockedPlatinumTemplates.push(templateKey);
                                    }

                                    // Guardamos o renovamos la vigencia de los 30 días para esta plantilla
                                    if (typeof user.subscriptions.set === 'function') {
                                        user.subscriptions.set(templateKey, { active: true, expiresAt: expirationDate });
                                    } else {
                                        user.subscriptions[templateKey] = { active: true, expiresAt: expirationDate };
                                    }

                                    await user.save();
                                    console.log(`Plantilla Platinum exclusiva (${templateKey}) asignada y con vigencia hasta ${expirationDate.toISOString()} para ${payerEmail}.`);
                                }
                            } else {
                                // Asignación unificada de plan y tokens para planes normales
                                user.plan = planDesdeRef;
                                user.tokens = getTokensForPlan(planDesdeRef);
                                await user.save();
                                console.log(`Licencia de ${payerEmail} actualizada por pago exitoso. Plan: ${planDesdeRef}, Páginas asignadas: ${user.tokens}.`);
                            }
                        }
                    }
                }
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Error en webhook de Mercado Pago:', error);
        res.status(500).json({ error: error.toString() });
    }
});

// ================= ENDPOINTS DE GENERACIÓN Y GESTIÓN =================

app.post('/api/generate', verifyToken, async (req, res) => {
    try {
        const { templateName, business, tagline, description, whatsapp } = req.body;

        let user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (user.tokens !== undefined && user.tokens <= 0) {
            return res.status(403).json({ error: 'No tienes tokens disponibles. Actualiza tu plan.' });
        }

        const activeTemplateKey = templateName || 'cafe';
        let templateHtml = STATIC_TEMPLATES[activeTemplateKey] || STATIC_TEMPLATES['cafe'];
        const cleanWhatsapp = whatsapp ? whatsapp.replace(/[^0-9]/g, '') : '';

        let htmlContent = templateHtml
            .replace(/\{\{BUSINESS_NAME\}\}/g, business || 'Mi Negocio')
            .replace(/\{\{TAGLINE\}\}/g, tagline || 'Tu mejor opción')
            .replace(/\{\{DESCRIPTION\}\}/g, description || 'Servicios profesionales adaptados a lo que necesitas.')
            .replace(/\{\{WHATSAPP\}\}/g, cleanWhatsapp);

        const landingId = Math.random().toString(36).substring(2, 9);
        const landingUrl = `https://landinggen.prestigecloser.com/preview/${landingId}`;
        
        const landingInfo = { 
            landingId, 
            business, 
            templateKey: activeTemplateKey, 
            url: landingUrl, 
            createdAt: new Date().toISOString() 
        };

        const newLanding = new Landing({
            landingId,
            userEmail: req.user.email,
            business,
            templateKey: activeTemplateKey,
            htmlContent
        });
        await newLanding.save();

        if (user.tokens > 0 && user.tokens < 999999) {
            user.tokens -= 1;
        }
        if (!user.landings) user.landings = [];
        user.landings.push(landingInfo);
        await user.save();

        res.json({ success: true, landingId, url: landingUrl, remainingTokens: user.tokens });
    } catch (error) {
        console.error('Error al generar la landing:', error);
        res.status(500).json({ error: 'Error al generar la landing' });
    }
});

app.post('/api/save-custom-landing', verifyToken, async (req, res) => {
    try {
        const { business, htmlContent, templateKey, whatsapp, isPlatinum } = req.body;

        let user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const activeTemplateKey = templateKey || 'cafe';

        // Detección estricta y robusta de plantilla Platinum (por bandera del cliente o por convención de clave)
        const isPlatinumTemplate = isPlatinum === true || 
                                   activeTemplateKey.startsWith('platinum_') || 
                                   activeTemplateKey.startsWith('platinum-') ||
                                   activeTemplateKey.includes('platinum');

        if (isPlatinumTemplate) {
            const hasUnlocked = user.unlockedPlatinumTemplates && user.unlockedPlatinumTemplates.includes(activeTemplateKey);
            
            if (!hasUnlocked) {
                return res.status(403).json({ 
                    error: 'ACCESO_RESTRINGIDO_PAGO',
                    message: 'Esta es una Plantilla Exclusiva Platinum. Debes adquirir su alquiler antes de publicarla.' 
                });
            }
        } else {
            // Validación de tokens para planes normales / plantillas estándar
            if (user.tokens !== undefined && user.tokens <= 0) {
                return res.status(403).json({ error: 'Has alcanzado el límite de tu plan. Actualiza tu membresía.' });
            }
        }

        const landingId = Math.random().toString(36).substring(2, 9);
        const landingUrl = `https://landinggen.prestigecloser.com/preview/${landingId}`;
        
        const newLanding = new Landing({
            landingId,
            userEmail: req.user.email,
            business: business || 'Mi Negocio',
            templateKey: activeTemplateKey,
            htmlContent: htmlContent || ''
        });
        await newLanding.save();

        // Descontar token solo si no es platinum y el usuario tiene tokens finitos
        if (!isPlatinumTemplate && user.tokens !== undefined && user.tokens > 0 && user.tokens < 999999) {
            user.tokens -= 1;
        }

        if (!user.landings) user.landings = [];
        user.landings.push({ 
            landingId, 
            business: business || 'Mi Negocio', 
            templateKey: activeTemplateKey, 
            url: landingUrl, 
            createdAt: new Date().toISOString() 
        });
        
        await user.save();

        res.json({ 
            success: true, 
            landingId, 
            url: landingUrl, 
            remainingTokens: user.tokens 
        });

    } catch (error) {
        console.error('CRITICAL ERROR en /api/save-custom-landing:', error);
        res.status(500).json({ error: 'Error interno en el servidor al guardar la página: ' + error.message });
    }
});

const handleGetLandings = async (req, res) => {
    try {
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const fullLandings = await Landing.find({ userEmail: req.user.email });
        
        const mappedLandings = (user.landings || []).map(l => {
            const dbLanding = fullLandings.find(fl => fl.landingId === l.landingId);
            return {
                ...(l.toObject ? l.toObject() : l),
                templateKey: l.templateKey || dbLanding?.templateKey || 'cafe'
            };
        });

        res.json({ success: true, landings: mappedLandings, unlockedPlatinumTemplates: user.unlockedPlatinumTemplates || [] });
    } catch (error) {
        console.error('Error al obtener las landings:', error);
        res.status(500).json({ error: 'Error al obtener las landings' });
    }
};

app.get('/api/landings', verifyToken, handleGetLandings);
app.get('/api/my-landings', verifyToken, handleGetLandings);

app.get('/api/preview/:landingId', async (req, res) => {
    try {
        const { landingId } = req.params;
        
        const landingData = await Landing.findOne({ landingId });
        if (!landingData || !landingData.htmlContent) {
            return res.status(404).send('Landing no encontrada');
        }
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(landingData.htmlContent);
    } catch (error) {
        res.status(500).send('Error al previsualizar');
    }
});

app.delete('/api/landings/:landingId', verifyToken, async (req, res) => {
    try {
        const { landingId } = req.params;
        let user = await User.findOne({ email: req.user.email });

        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        user.landings = (user.landings || []).filter(l => l.landingId !== landingId);
        await user.save();

        await Landing.deleteOne({ landingId });

        res.json({ success: true, message: 'Landing eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar la landing' });
    }
});

// ================= RUTA PÚBLICA PARA SERVIR LA LANDING ESTÁTICA =================
// ================= RUTA PÚBLICA PARA SERVIR LA LANDING ESTÁTICA =================
app.get('/:landingId', async (req, res) => {
    try {
        const { landingId } = req.params;
        
        if (landingId === 'api' || landingId === 'favicon.ico') {
            return res.status(404).send('No encontrado');
        }

        const landingData = await Landing.findOne({ landingId });

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

        // VALIDACIÓN DE VIGENCIA PLATINUM (30 DÍAS)
        const templateKey = landingData.templateKey;
        if (typeof esPlantillaPlatinum === 'function' && esPlantillaPlatinum(templateKey)) {
            const owner = await User.findOne({ email: landingData.userEmail });
            
            if (owner) {
                const hasUnlocked = owner.unlockedPlatinumTemplates && owner.unlockedPlatinumTemplates.includes(templateKey);
                
                // Obtener fecha de expiración del mapa o objeto subscriptions
                const subData = owner.subscriptions && typeof owner.subscriptions.get === 'function' 
                    ? owner.subscriptions.get(templateKey) 
                    : owner?.subscriptions?.[templateKey];

                const now = new Date();
                const isExpired = subData && subData.expiresAt ? new Date(subData.expiresAt) < now : false;

                // Si no la ha desbloqueado o su suscripción ya venció (más de 30 días)
                if (!hasUnlocked || isExpired) {
                    return res.send(`
                        <!DOCTYPE html>
                        <html lang="es">
                        <head>
                            <meta charset="UTF-8">
                            <title>Servicio Suspendido - Plantilla Fuera de Servicio</title>
                            <script src="https://cdn.tailwindcss.com"></script>
                            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                        </head>
                        <body class="bg-gray-950 text-white h-screen flex flex-col items-center justify-center text-center px-4">
                            <div class="bg-gray-900 p-8 rounded-2xl border border-red-500/30 shadow-2xl max-w-md w-full">
                                <div class="text-red-500 text-5xl mb-4 animate-pulse"><i class="fa-solid fa-triangle-exclamation"></i></div>
                                <h1 class="text-2xl font-bold mb-2">Plantilla Fuera de Servicio</h1>
                                <p class="text-gray-400 text-sm mb-6">El alquiler exclusivo de esta plantilla Platinum no ha sido renovado por su propietario. El sitio web se encuentra temporalmente suspendido.</p>
                                <span class="inline-block bg-red-500/10 text-red-400 border border-red-500/20 text-xs px-3 py-1.5 rounded-full font-medium">Estado: Suspendido por falta de renovación</span>
                            </div>
                        </body>
                        </html>
                    `);
                }
            }
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(landingData.htmlContent);
    } catch (error) {
        res.status(500).send('Error interno del servidor al cargar la página');
    }
});

app.get('/api/verify-platinum-access', verifyToken, async (req, res) => {
    try {
        const userEmail = (req.user?.email || "").trim().toLowerCase();
        const user = await User.findOne({ email: userEmail });

        if (!user) {
            return res.status(404).json({ authorized: false, error: "Usuario no encontrado" });
        }

        const isPlatinum = user.plan === 'agency_platinum';

        if (!isPlatinum) {
            return res.status(403).json({ 
                authorized: false, 
                error: "Se requiere el Plan Agencia Platinum para acceder a esta sección." 
            });
        }

        return res.json({ 
            authorized: true, 
            plan: user.plan,
            unlockedTemplates: user.unlockedPlatinumTemplates || []
        });

    } catch (error) {
        console.error("Error verificando acceso Platinum en backend:", error);
        return res.status(500).json({ authorized: false, error: "Error interno del servidor" });
    }
});

// =========================================================================
// 2. ENDPOINT DE ACTUALIZACIÓN (PUT) POR SI EL EDITOR USA ESTA RUTA AL GUARDAR
// =========================================================================
app.put('/api/landings/:landingId', verifyToken, async (req, res) => {
    try {
        const { landingId } = req.params;
        const { business, htmlContent, templateKey } = req.body;
        const userEmail = req.user.email;

        let user = await User.findOne({ email: userEmail });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const existingLanding = await Landing.findOne({ landingId, userEmail });
        const finalTemplateKey = templateKey || existingLanding?.templateKey || 'cafe';

        if (typeof esPlantillaPlatinum === 'function' && esPlantillaPlatinum(finalTemplateKey)) {
            const hasUnlocked = user.unlockedPlatinumTemplates && user.unlockedPlatinumTemplates.includes(finalTemplateKey);
            
            // Verificar si la suscripción de 30 días ya expiró
            const subData = user.subscriptions && typeof user.subscriptions.get === 'function' 
                ? user.subscriptions.get(finalTemplateKey) 
                : user?.subscriptions?.[finalTemplateKey];
            
            const now = new Date();
            const isExpired = subData && subData.expiresAt ? new Date(subData.expiresAt) < now : false;

            if (!hasUnlocked || isExpired) {
                const preferenceData = {
                    body: {
                        items: [{
                            title: `Renovación / Alquiler Plantilla Exclusiva: ${finalTemplateKey}`,
                            quantity: 1,
                            currency_id: 'COP',
                            unit_price: 300000 
                        }],
                        payer: { email: user.email },
                        back_urls: {
                            success: `https://landinggen.prestigecloser.com/?status=success&unlocked=${finalTemplateKey}`,
                            failure: 'https://landinggen.prestigecloser.com/?status=failure',
                            pending: 'https://landinggen.prestigecloser.com/?status=pending'
                        },
                        auto_return: 'approved',
                        notification_url: 'https://landing-ai-backend.onrender.com/api/webhook-mercadopago',
                        external_reference: `${user.email}|platinum_template_${finalTemplateKey}`
                    }
                };

                const preference = new Preference(mpClient);
                const result = await preference.create(preferenceData);
                const initPoint = result.init_point || result.sandbox_init_point;

                return res.status(403).json({
                    requiresPayment: true,
                    init_point: initPoint,
                    error: 'ACCESO_RESTRINGIDO_PAGO',
                    message: 'Las plantillas Platinum requieren una suscripción vigente mes a mes para su publicación.'
                });
            }
        }

        const updatedLanding = await Landing.findOneAndUpdate(
            { landingId, userEmail },
            { business: business || 'Mi Negocio', htmlContent, templateKey: finalTemplateKey },
            { new: true }
        );

        if (!updatedLanding) {
            return res.status(404).json({ error: 'Landing no encontrada o no autorizada' });
        }

        res.json({ success: true, message: 'Landing actualizada correctamente', landingId });
    } catch (error) {
        console.error('Error en PUT /api/landings/:landingId:', error);
        res.status(500).json({ error: 'Error interno del servidor al actualizar la página' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
