const express = require('express');
const cors = require('cors'); 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const { MercadoPagoConfig, Preference } = require('mercadopago');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro';

// Definición de tu dominio base limpio para los subdominios (ej. webzyo.com)
const MAIN_DOMAIN = 'webzyo.com';
const MAIN_CSS_URL = `https://${MAIN_DOMAIN}/dist/output.css`;

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

// Servir la carpeta /dist públicamente con headers CSS explícitos
app.use('/dist', express.static(path.join(__dirname, 'dist'), {
    maxAge: '7d',
    immutable: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        }
    }
}));

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
    templateKey: { type: String }, 
    slug: { type: String, required: true, unique: true, index: true }, 
    subdomain: { type: String, index: true },
    htmlContent: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    plan: { type: String, default: 'free' },
    tokens: { type: Number, default: 200 },
    planExpiresAt: { type: Date, default: null }, 
    landings: [{
        landingId: String,
        business: String,
        templateKey: String, 
        slug: String,        
        url: String,
        createdAt: String
    }],
    unlockedPlatinumTemplates: { type: [String], default: [] },
    activeExclusiveRentals: [String],
    subscriptions: { type: Map, of: Object, default: {} } 
});

const Landing = mongoose.model('Landing', landingSchema);
const User = mongoose.model('User', userSchema);

function esPlantillaPlatinum(templateKey) {
    if (!templateKey) return false;
    const key = templateKey.toLowerCase();
    return key.startsWith('platinum_') || key.startsWith('platinum-') || key.includes('platinum');
}

// ================= SERVICIO DE CORREOS BREVO =================
async function enviarCorreoBrevo({ toEmail, toName, subject, htmlContent, textContent }) {
    try {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            console.warn("[BREVO] API Key no configurada. No se pudo enviar el correo a:", toEmail);
            return false;
        }

        if (!toEmail || !subject || !htmlContent) {
            console.warn("[BREVO] Faltan campos obligatorios (toEmail, subject, htmlContent).");
            return false;
        }

        const payload = {
            sender: {
                name: process.env.BREVO_SENDER_NAME || 'Webzyo',
                email: process.env.BREVO_SENDER_EMAIL || 'no-reply@webzyo.com'
            },
            to: [
                {
                    email: String(toEmail).trim().toLowerCase(),
                    name: toName || 'Usuario'
                }
            ],
            subject,
            htmlContent
        };

        if (textContent) {
            payload.textContent = textContent;
        }

        const response = await axios.post(
            'https://api.brevo.com/v3/smtp/email',
            payload,
            {
                headers: {
                    'accept': 'application/json',
                    'api-key': apiKey,
                    'content-type': 'application/json'
                },
                timeout: 10000
            }
        );

        console.log(`[BREVO] Correo enviado con éxito a ${toEmail}. MessageId:`, response.data?.messageId);
        return true;
    } catch (error) {
        console.error('[BREVO ERROR] Falló el envío de correo:', error.response?.data || error.message);
        return false;
    }
}

function getTokensForPlan(plan) {
    switch (plan) {
        case 'starter': return 3;
        case 'pro':
        case 'business':
        case 'agency_platinum': return 999999; 
        case 'free':
        default: return 200;
    }
}

async function handleGetLandings(req, res) {
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
}

// ================= REPOSITORIO DE PLANTILLAS ESTÁTICAS =================
const STATIC_TEMPLATES = {
    cafe: `<!DOCTYPE html>
<html lang="es" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{BUSINESS_NAME}}</title>
    <link rel="stylesheet" href="${MAIN_CSS_URL}">
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

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader(
        "Content-Security-Policy",
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
    );
    next();
});

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

        try {
            await enviarCorreoBrevo({
                toEmail: cleanEmail,
                toName: cleanEmail.split('@')[0],
                subject: '¡Bienvenido a LandingGen! Tu cuenta Free está lista 🚀',
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: auto;">
                        <h2 style="color: #818cf8; margin-top: 0;">¡Hola! Tu cuenta Free ha sido creada con éxito</h2>
                        <p style="color: #94a3b8; line-height: 1.5;">Ya puedes empezar a crear y explorar tus primeras landing pages profesionales en LandingGen y conectar tu WhatsApp en segundos.</p>
                        <a href="https://${MAIN_DOMAIN}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px;">Ir a mi Panel</a>
                    </div>
                `
            });
        } catch (emailErr) {
            console.error("Error al enviar correo de bienvenida con Brevo:", emailErr);
        }

        const token = jwt.sign({ email: cleanEmail }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, plan, tokens: newUser.tokens });
    } catch (error) {
        console.error("Error en registro:", error);
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
app.post('/api/create-preference', verifyToken, async (req, res) => {
    try {
        const { planName, email } = req.body;
        
        const emailCliente = (email || req.user?.email || "").trim().toLowerCase();
        if (!emailCliente) {
            return res.status(400).json({ error: "El correo electrónico es requerido para procesar el pago." });
        }

        const planRaw = (planName || "pro").toLowerCase().trim();

        const preciosUSD = {
            "pro": { nombre: "Plan Pro Negocios", precioUSD: 10, tokens: 5 },
            "agency_platinum": { nombre: "Plan Agencia Platinum", precioUSD: 25, tokens: 10 }
        };

        let infoPlan;
        let planId = planRaw;

        if (planRaw.startsWith('platinum_template_') || planRaw.startsWith('platinum_')) {
            const templateKey = planRaw
                .replace('platinum_template_', '')
                .replace('platinum_', '');
            
            const alreadyTaken = await User.findOne({
                email: { $ne: emailCliente },
                unlockedPlatinumTemplates: templateKey
            });

            if (alreadyTaken) {
                return res.status(400).json({ 
                    error: 'Lo sentimos, esta plantilla exclusiva ya fue alquilada por otro usuario y ya no está disponible.' 
                });
            }

            const currentUser = await User.findOne({ email: emailCliente });
            if (currentUser && currentUser.unlockedPlatinumTemplates && currentUser.unlockedPlatinumTemplates.includes(templateKey)) {
                return res.status(400).json({ error: 'Ya tienes desbloqueada esta plantilla exclusiva.' });
            }

            infoPlan = {
                nombre: `Alquiler Plantilla Platinum (${templateKey})`,
                precioUSD: 25,
                tokens: 0 
            };

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
                    success: `https://${MAIN_DOMAIN}/?status=success`,
                    failure: `https://${MAIN_DOMAIN}/?status=failure`,
                    pending: `https://${MAIN_DOMAIN}/?status=pending`
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
                        const normalizedPlan = String(planDesdeRef || "pro").trim().toLowerCase();
                        const isPaidAccountPlan = normalizedPlan === 'pro' || normalizedPlan === 'agency_platinum';
                        const isPlatinumPayment = normalizedPlan.startsWith('platinum_template_') || normalizedPlan.startsWith('platinum_');

                        let user = await User.findOne({ email: payerEmail });
                        let tempPassword = null;

                        // Si compra 'pro' o 'agency_platinum' y el usuario no existe aún, creamos su cuenta con contraseña temporal
                        if (!user && isPaidAccountPlan) {
                            tempPassword = generateTempPassword(10);
                            user = new User({
                                email: payerEmail,
                                name: payerEmail.split('@')[0],
                                password: tempPassword,
                                plan: normalizedPlan,
                                tokens: getTokensForPlan(normalizedPlan)
                            });
                        }

                        if (user) {
                            if (isPlatinumPayment) {
                                const templateKey = normalizedPlan
                                    .replace('platinum_template_', '')
                                    .replace('platinum_', '');
                            
                                const alreadyClaimed = await User.findOne({
                                    _id: { $ne: user._id },
                                    unlockedPlatinumTemplates: templateKey
                                });

                                if (!alreadyClaimed) {
                                    const expirationDate = new Date();
                                    expirationDate.setDate(expirationDate.getDate() + 30);

                                    if (!user.unlockedPlatinumTemplates) user.unlockedPlatinumTemplates = [];
                                    if (!user.subscriptions) user.subscriptions = {};

                                    if (!user.unlockedPlatinumTemplates.includes(templateKey)) {
                                        user.unlockedPlatinumTemplates.push(templateKey);
                                    }

                                    if (typeof user.subscriptions.set === 'function') {
                                        user.subscriptions.set(templateKey, { active: true, expiresAt: expirationDate });
                                    } else {
                                        user.subscriptions[templateKey] = { active: true, expiresAt: expirationDate };
                                    }

                                    await user.save();

                                    try {
                                        await enviarCorreoBrevo({
                                            toEmail: payerEmail,
                                            toName: payerEmail.split('@')[0],
                                            subject: `¡Alquiler Platinum Exclusivo Activado (${templateKey})! 👑`,
                                            htmlContent: `
                                                <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: auto;">
                                                    <h2 style="color: #818cf8; margin-top: 0;">¡Alquiler Platinum Confirmado!</h2>
                                                    <p style="color: #94a3b8; line-height: 1.5;">Has adquirido con éxito el alquiler exclusivo de la plantilla <strong>${templateKey}</strong> por los próximos 30 días.</p>
                                                    <a href="https://${MAIN_DOMAIN}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px;">Ir a mi Panel</a>
                                                </div>
                                            `
                                        });
                                    } catch (emailErr) {
                                        console.error("Error al enviar correo Brevo para Platinum:", emailErr);
                                    }
                                }
                            } else {
                                // Si es 'pro' o 'agency_platinum' y el usuario ya existía pero no tenía contraseña asignada, generamos una temporal
                                if (isPaidAccountPlan && !user.password) {
                                    tempPassword = generateTempPassword(10);
                                    user.password = tempPassword;
                                }

                                user.plan = normalizedPlan;
                                user.tokens = getTokensForPlan(normalizedPlan);
                                
                                const planExpirationDate = new Date();
                                planExpirationDate.setDate(planExpirationDate.getDate() + 30);
                                user.planExpiresAt = planExpirationDate;

                                await user.save();

                                const credentialsSection = isPaidAccountPlan
                                    ? (tempPassword
                                        ? `
                                            <div style="background-color: #1e293b; border: 1px solid #334155; padding: 16px; border-radius: 8px; margin: 18px 0;">
                                                <p style="margin: 4px 0; color: #e2e8f0;"><strong>Correo / Usuario:</strong> ${payerEmail}</p>
                                                <p style="margin: 4px 0; color: #fbbf24;"><strong>Contraseña temporal:</strong> ${tempPassword}</p>
                                            </div>
                                            <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">Te recomendamos cambiar esta contraseña una vez que inicies sesión en tu cuenta.</p>
                                        `
                                        : `
                                            <div style="background-color: #1e293b; border: 1px solid #334155; padding: 16px; border-radius: 8px; margin: 18px 0;">
                                                <p style="margin: 4px 0; color: #e2e8f0;"><strong>Correo / Usuario:</strong> ${payerEmail}</p>
                                                <p style="margin: 4px 0; color: #94a3b8;">Inicia sesión con la contraseña actual de tu cuenta para acceder a las funciones de tu plan.</p>
                                            </div>
                                        `)
                                    : '';

                                try {
                                    await enviarCorreoBrevo({
                                        toEmail: payerEmail,
                                        toName: payerEmail.split('@')[0],
                                        subject: `¡Suscripción Actualizada a Plan ${normalizedPlan.toUpperCase()}! 🎉`,
                                        htmlContent: `
                                            <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: auto;">
                                                <h2 style="color: #818cf8; margin-top: 0;">¡Pago de Suscripción Aprobado!</h2>
                                                <p style="color: #94a3b8; line-height: 1.5;">Tu cuenta ha sido actualizada al plan <strong>${normalizedPlan.toUpperCase()}</strong> con éxito.</p>
                                                ${credentialsSection}
                                                <a href="https://${MAIN_DOMAIN}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px;">Ir a mi Panel</a>
                                            </div>
                                        `
                                    });
                                } catch (emailErr) {
                                    console.error("Error al enviar correo Brevo para plan general:", emailErr);
                                }
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
        
        const rawBusiness = business || 'negocio';
        const subdomain = rawBusiness.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
            .replace(/[^a-z0-9-_]/g, '-') 
            .replace(/-+/g, '-') 
            .replace(/^-|-$/g, ''); 

        const finalSubdomain = subdomain || landingId; 
        const landingUrl = `https://${finalSubdomain}.${MAIN_DOMAIN}`;
        
        const newLanding = new Landing({
            landingId,
            slug: finalSubdomain,
            subdomain: finalSubdomain, 
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
        user.landings.push({ 
            landingId, 
            slug: finalSubdomain,
            subdomain: finalSubdomain,
            business, 
            templateKey: activeTemplateKey, 
            url: landingUrl, 
            createdAt: new Date().toISOString() 
        });
        await user.save();

        res.json({ success: true, landingId, url: landingUrl, remainingTokens: user.tokens });
    } catch (error) {
        console.error('Error al generar la landing:', error);
        res.status(500).json({ error: 'Error al generar la landing' });
    }
});

app.post('/api/save-custom-landing', verifyToken, async (req, res) => {
    try {
        const { business, htmlContent, templateKey, whatsapp, isPlatinum, slug } = req.body;

        let user = await User.findOne({ email: req.user.email });
        if (!user) {
            return res.status(404).json({ 
                success: false,
                modalTitle: 'Usuario no encontrado',
                error: 'No pudimos encontrar tu cuenta en el sistema.' 
            });
        }

        const activeTemplateKey = templateKey || 'cafe';

        const isPlatinumTemplate = isPlatinum === true || 
                                   activeTemplateKey.startsWith('platinum_') || 
                                   activeTemplateKey.startsWith('platinum-') ||
                                   activeTemplateKey.includes('platinum');

        if (isPlatinumTemplate) {
            const hasUnlocked = user.unlockedPlatinumTemplates && user.unlockedPlatinumTemplates.includes(activeTemplateKey);
            
            if (!hasUnlocked) {
                const preferenceData = {
                    body: {
                        items: [{
                            title: `Alquiler Plantilla Exclusiva Platinum: ${activeTemplateKey}`,
                            quantity: 1,
                            currency_id: 'COP',
                            unit_price: 300000 
                        }],
                        payer: { email: user.email },
                        back_urls: {
                            success: `https://${MAIN_DOMAIN}/?status=success&unlocked=${activeTemplateKey}`,
                            failure: `https://${MAIN_DOMAIN}/?status=failure`,
                            pending: `https://${MAIN_DOMAIN}/?status=pending`
                        },
                        auto_return: 'approved',
                        notification_url: 'https://landing-ai-backend.onrender.com/api/webhook-mercadopago',
                        external_reference: `${user.email}|platinum_template_${activeTemplateKey}`
                    }
                };

                const preference = new Preference(mpClient);
                const result = await preference.create(preferenceData);
                const initPoint = result.init_point || result.sandbox_init_point;

                // Respuesta estructurada para abrir un modal de PAGO / PLATINUM nativo en el frontend
                return res.status(403).json({ 
                    success: false,
                    requiresPayment: true,
                    modalType: 'payment_platinum',
                    modalTitle: 'Plantilla Exclusiva Platinum',
                    init_point: initPoint,
                    error: 'ACCESO_RESTRINGIDO_PAGO',
                    message: 'Esta es una Plantilla Exclusiva Platinum. Debes adquirir su alquiler antes de publicarla.' 
                });
            }
        } else {
            if (user.tokens !== undefined && user.tokens <= 0) {
                return res.status(403).json({ 
                    success: false,
                    modalType: 'alert_tokens',
                    modalTitle: 'Límite Alcanzado',
                    error: 'Has alcanzado el límite de tu plan. Actualiza tu membresía.' 
                });
            }
        }

        const cleanSlug = slug 
            ? slug.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-_]/g, '').replace(/-+/g, '-')
            : '';

        if (!cleanSlug) {
            return res.status(400).json({ 
                success: false,
                modalType: 'alert_slug',
                modalTitle: 'Enlace Inválido',
                error: 'Por favor, proporciona un enlace o subdominio válido.' 
            });
        }

        const existingLandingWithSlug = await Landing.findOne({ 
            $or: [{ slug: cleanSlug }, { subdomain: cleanSlug }] 
        });
        
        if (existingLandingWithSlug) {
            return res.status(400).json({ 
                success: false,
                modalType: 'alert_slug_in_use',
                modalTitle: 'Enlace Ocupado',
                error: `El enlace "${cleanSlug}" ya está en uso. Por favor, elige otro.` 
            });
        }

        const landingId = Math.random().toString(36).substring(2, 9);
        const landingUrl = `https://${cleanSlug}.${MAIN_DOMAIN}`;
        
        const newLanding = new Landing({
            landingId,
            slug: cleanSlug,
            subdomain: cleanSlug, 
            userEmail: req.user.email,
            business: business || 'Mi Negocio',
            templateKey: activeTemplateKey,
            htmlContent: htmlContent || ''
        });
        await newLanding.save();

        if (!isPlatinumTemplate && user.tokens !== undefined && user.tokens > 0 && user.tokens < 999999) {
            user.tokens -= 1;
        }

        if (!user.landings) user.landings = [];
        user.landings.push({ 
            landingId, 
            slug: cleanSlug,
            subdomain: cleanSlug,
            business: business || 'Mi Negocio', 
            templateKey: activeTemplateKey, 
            url: landingUrl, 
            createdAt: new Date().toISOString() 
        });
        
        await user.save();

        // Respuesta de ÉXITO estructurada para el modal nativo verde/éxito
        res.json({ 
            success: true, 
            modalType: 'success_published',
            modalTitle: '¡Publicado con Éxito! 🚀',
            message: 'Tu página web ha sido guardada y publicada correctamente.',
            landingId, 
            url: landingUrl, 
            remainingTokens: user.tokens 
        });

    } catch (error) {
        console.error('CRITICAL ERROR en /api/save-custom-landing:', error);
        res.status(500).json({ 
            success: false,
            modalType: 'error_server',
            modalTitle: 'Error del Servidor',
            error: 'Error interno en el servidor al guardar la página: ' + error.message 
        });
    }
});

app.get('/api/landings', verifyToken, handleGetLandings);
app.get('/api/my-landings', verifyToken, handleGetLandings);

app.get('/api/preview/:landingId', async (req, res) => {
    try {
        const { landingId } = req.params;
        const landingData = await Landing.findOne({ landingId });
        if (!landingData || !landingData.htmlContent) {
            return res.status(404).send('Landing no encontrada');
        }

        let renderedHtml = landingData.htmlContent;
        if (!renderedHtml.includes(MAIN_CSS_URL)) {
            renderedHtml = renderedHtml.replace('</head>', `<link rel="stylesheet" href="${MAIN_CSS_URL}"></head>`);
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderedHtml);
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

// ================= ENDPOINT DE ESTADO DE USUARIO =================
app.get('/api/user-status', verifyToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Validar si expiró el plan general para degradarlo a free
        const now = new Date();
        if (user.plan !== 'free' && user.planExpiresAt && new Date(user.planExpiresAt) < now) {
            user.plan = 'free';
            user.tokens = getTokensForPlan('free');
            await user.save();
        }

        res.json({
            success: true,
            email: user.email,
            plan: user.plan || 'free',
            tokens: user.tokens ?? getTokensForPlan(user.plan || 'free'),
            unlockedPlatinumTemplates: user.unlockedPlatinumTemplates || []
        });
    } catch (error) {
        console.error('Error al obtener estado del usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================= RUTA PARA EL PROXY DE SUBDOMINIOS Y FREEMIUM BANNER =================
app.get('/public-landing/:slug', async (req, res) => {
    try {
        const subdominioBuscado = (req.params.slug || '').toLowerCase().trim();

        const landingData = await Landing.findOne({
            $or: [
                { slug: subdominioBuscado },
                { subdomain: subdominioBuscado }
            ]
        });

        if (!landingData || !landingData.htmlContent) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Página no encontrada</title>
                    <link rel="stylesheet" href="${MAIN_CSS_URL}">
                </head>
                <body class="bg-slate-950 text-white flex items-center justify-center h-screen">
                    <div class="text-center space-y-3">
                        <h1 class="text-4xl font-bold text-indigo-500">404</h1>
                        <p class="text-slate-400">La página web que buscas no existe o el subdominio está inactivo.</p>
                    </div>
                </body>
                </html>
            `);
        }

        const owner = await User.findOne({ email: landingData.userEmail });
        let isFreePlan = !owner || owner.plan === 'free' || !owner.plan;

        if (owner) {
            const now = new Date();
            const planVencido = owner.planExpiresAt && new Date(owner.planExpiresAt) < now;

            if (planVencido && owner.plan !== 'free') {
                return res.send(`
                    <!DOCTYPE html>
                    <html lang="es">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Suscripción Vencida - Servicio Suspendido</title>
                        <link rel="stylesheet" href="${MAIN_CSS_URL}">
                    </head>
                    <body class="bg-gray-950 text-white h-screen flex flex-col items-center justify-center text-center px-4">
                        <div class="bg-gray-900 p-8 rounded-2xl border border-amber-500/30 shadow-2xl max-w-md w-full">
                            <h1 class="text-2xl font-bold mb-2">Suscripción General Vencida</h1>
                            <p class="text-gray-400 text-sm mb-6">El sitio se encuentra suspendido temporalmente por falta de renovación del plan general.</p>
                        </div>
                    </body>
                    </html>
                `);
            }

            const templateKey = landingData.templateKey;
            if (typeof esPlantillaPlatinum === 'function' && esPlantillaPlatinum(templateKey)) {
                const hasUnlocked = owner.unlockedPlatinumTemplates && owner.unlockedPlatinumTemplates.includes(templateKey);
                const subData = owner.subscriptions && typeof owner.subscriptions.get === 'function'
                    ? owner.subscriptions.get(templateKey)
                    : owner?.subscriptions?.[templateKey];

                const isExpired = subData && subData.expiresAt ? new Date(subData.expiresAt) < now : false;

                if (!hasUnlocked || isExpired) {
                    return res.send(`
                        <!DOCTYPE html>
                        <html lang="es">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Servicio Suspendido - Plantilla Fuera de Servicio</title>
                            <link rel="stylesheet" href="${MAIN_CSS_URL}">
                        </head>
                        <body class="bg-gray-950 text-white h-screen flex flex-col items-center justify-center text-center px-4">
                            <div class="bg-gray-900 p-8 rounded-2xl border border-red-500/30 shadow-2xl max-w-md w-full">
                                <h1 class="text-2xl font-bold mb-2">Plantilla Fuera de Servicio</h1>
                                <p class="text-gray-400 text-sm mb-6">El alquiler exclusivo de esta plantilla Platinum no ha sido renovado.</p>
                            </div>
                        </body>
                        </html>
                    `);
                }
            }
        }

        let renderedHtml = landingData.htmlContent;

        // INYECCIÓN DE BANNER AZUL MÁS DELGADO Y CON DIFUMINADO LATERAL AMPLIO
        if (isFreePlan) {
            const freeBannerHtml = `
                <style>
                    /* Ajustar el padding inferior de la página acorde al banner más delgado */
                    body {
                        padding-bottom: 50px !important;
                    }
                    #landinggen-free-badge {
                        position: fixed;
                        bottom: 0;
                        left: 0;
                        width: 100%;
                        z-index: 999999;
                        /* Degradado azul con difuminado lateral mucho más largo y extendido */
                        background: linear-gradient(90deg, rgba(30, 58, 138, 0) 0%, rgba(30, 64, 175, 0.4) 25%, rgba(30, 64, 175, 0.9) 50%, rgba(30, 64, 175, 0.4) 75%, rgba(30, 58, 138, 0) 100%);
                        backdrop-filter: blur(6px);
                        -webkit-backdrop-filter: blur(6px);
                        color: white;
                        padding: 6px 30px; /* Menos alto (más delgado) */
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 16px;
                        box-shadow: 0 -4px 15px rgba(0, 0, 0, 0.2);
                        font-family: 'Plus Jakarta Sans', sans-serif;
                    }
                    #landinggen-free-badge a.cta-btn {
                        background: #3b82f6;
                        color: #ffffff;
                        padding: 4px 12px; /* Botón más compacto */
                        border-radius: 9999px;
                        font-weight: 700;
                        font-size: 12px;
                        text-decoration: none;
                        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
                        white-space: nowrap;
                        transition: background 0.2s;
                    }
                    #landinggen-free-badge a.cta-btn:hover {
                        background: #2563eb;
                    }
                    @media (max-width: 640px) {
                        #landinggen-free-badge {
                            flex-direction: column;
                            gap: 6px;
                            padding: 8px 12px;
                            text-align: center;
                            font-size: 11px;
                            background: rgba(30, 64, 175, 0.95); /* En móvil se mantiene sólido para legibilidad */
                        }
                    }
                </style>
                <div id="landinggen-free-badge">
                    <span style="font-size: 12px; font-weight: 500;">
                        🚀 Esta página fue creada con <strong style="font-weight: 700;">WebZyo.com</strong>. ¿Quieres una para tu negocio?
                    </span>
                    <a href="https://${MAIN_DOMAIN}/#precios" target="_blank" class="cta-btn">Crear mi Landing Gratis</a>
                </div>
            `;

            if (renderedHtml.includes('</body>')) {
                renderedHtml = renderedHtml.replace('</body>', freeBannerHtml + '</body>');
            } else {
                renderedHtml += freeBannerHtml;
            }
        }

        // INYECCIÓN DE SCRIPT DE MÉTRICAS (VISITAS, CLICS Y RETENCIÓN)
        const trackedLandingId = landingData.landingId || String(landingData._id);
        const trackerScriptHtml = `
<script data-webzyo-tracker="true">
(function() {
  const LANDING_ID = ${JSON.stringify(String(trackedLandingId))};
  const TRACK_URL = ${JSON.stringify(`${req.protocol}://${req.get('host')}/api/metrics/track`)};
  const startTime = Date.now();
  let sentDwell = false;

  function sendEvent(payload) {
    const body = JSON.stringify({ landingId: LANDING_ID, ...payload });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(TRACK_URL, blob);
    } else {
      fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    }
  }

  sendEvent({ eventType: 'view' });

  document.addEventListener('click', function(e) {
    if (e.target.closest('a, button')) {
      sendEvent({ eventType: 'click' });
    }
  });

  function reportDwell() {
    if (sentDwell) return;
    sentDwell = true;
    const dwellSeconds = Math.round((Date.now() - startTime) / 1000);
    sendEvent({ eventType: 'dwell', dwellSeconds });
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') reportDwell();
  });
  window.addEventListener('pagehide', reportDwell);
})();
</script>`;

        if (renderedHtml.includes('</body>')) {
            renderedHtml = renderedHtml.replace('</body>', trackerScriptHtml + '\n</body>');
        } else {
            renderedHtml += trackerScriptHtml;
        }

        if (!renderedHtml.includes(MAIN_CSS_URL)) {
            if (renderedHtml.includes('</head>')) {
                renderedHtml = renderedHtml.replace('</head>', `<link rel="stylesheet" href="${MAIN_CSS_URL}"></head>`);
            } else {
                renderedHtml = `<link rel="stylesheet" href="${MAIN_CSS_URL}">` + renderedHtml;
            }
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderedHtml);

    } catch (error) {
        console.error('Error interno al servir la landing pública:', error);
        res.status(500).send('Error interno del servidor');
    }
});

const landingMetricSchema = new mongoose.Schema({
  landingId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  userEmail: { type: String, default: '', index: true },
  slug: { type: String, default: '' },
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  totalDwellSeconds: { type: Number, default: 0 },
  engagedOver30s: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

const LandingMetric = mongoose.models.LandingMetric || mongoose.model('LandingMetric', landingMetricSchema);

// Recibe eventos desde las páginas publicadas (visita, clic, tiempo de retención)
app.post('/api/metrics/track', async (req, res) => {
  try {
    const { landingId, eventType, dwellSeconds = 0 } = req.body || {};
    if (!landingId || !eventType) {
      return res.status(400).json({ ok: false, error: 'landingId y eventType son obligatorios' });
    }

    const cleanLandingId = String(landingId).trim();

    // Buscar la landing por tu campo custom `landingId` o por `_id` de MongoDB
    const orQuery = [{ landingId: cleanLandingId }];
    if (mongoose.Types.ObjectId.isValid(cleanLandingId)) {
      orQuery.push({ _id: cleanLandingId });
    }

    const landingDoc = await Landing.findOne({ $or: orQuery }).lean().catch(() => null);

    let ownerId = null;
    let ownerEmail = '';
    let slug = '';

    if (landingDoc) {
      ownerEmail = String(landingDoc.userEmail || '').trim().toLowerCase();
      slug = landingDoc.slug || landingDoc.subdomain || '';

      if (ownerEmail) {
        const ownerUser = await User.findOne({ email: ownerEmail }).select('_id').lean().catch(() => null);
        if (ownerUser) {
          ownerId = ownerUser._id;
        }
      }
    }

    const setFields = {
      updatedAt: new Date(),
      ...(ownerId ? { userId: ownerId } : {}),
      ...(ownerEmail ? { userEmail: ownerEmail } : {}),
      ...(slug ? { slug } : {})
    };

    const $inc = {};
    if (eventType === 'view') {
      $inc.views = 1;
    } else if (eventType === 'click') {
      $inc.clicks = 1;
    } else if (eventType === 'dwell') {
      const secs = Math.min(Math.max(Number(dwellSeconds) || 0, 0), 3600);
      $inc.totalDwellSeconds = secs;
      if (secs >= 30) {
        $inc.engagedOver30s = 1;
      }
    }

    const canonicalId = landingDoc?.landingId || cleanLandingId;

    await LandingMetric.findOneAndUpdate(
      { landingId: String(canonicalId) },
      {
        $set: setFields,
        ...(Object.keys($inc).length ? { $inc } : {})
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /api/metrics/track:', err);
    res.status(500).json({ ok: false });
  }
});

// Devuelve las métricas de las páginas del usuario autenticado
app.get('/api/user/metrics', verifyToken, async (req, res) => {
  try {
    const userEmail = String(req.user?.email || '').trim().toLowerCase();
    if (!userEmail) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }

    const user = await User.findOne({ email: userEmail }).select('_id email landings').lean();
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    // Obtener todas las landings del usuario desde la colección Landing
    const userLandings = await Landing.find({ userEmail }).lean();

    // Buscar sus métricas tanto por userEmail, userId o por la lista de landingIds
    const landingIdsList = userLandings.map(l => String(l.landingId || l._id));
    const metricsDocs = await LandingMetric.find({
      $or: [
        { userEmail },
        { userId: user._id },
        ...(landingIdsList.length ? [{ landingId: { $in: landingIdsList } }] : [])
      ]
    }).lean();

    const metricsMap = new Map(metricsDocs.map(m => [String(m.landingId), m]));

    const pages = userLandings.map((l) => {
      const idStr = String(l.landingId || l._id);
      const m = metricsMap.get(idStr) || metricsMap.get(String(l._id)) || {};
      const views = m.views || 0;
      const clicks = m.clicks || 0;
      const totalDwell = m.totalDwellSeconds || 0;

      return {
        landingId: idStr,
        title: l.business?.name || l.businessName || l.title || l.slug || l.subdomain || 'Landing',
        slug: l.slug || l.subdomain || m.slug || '',
        views,
        clicks,
        avgDwellSeconds: views > 0 ? totalDwell / views : 0,
        engagedOver30s: m.engagedOver30s || 0
      };
    });

    res.json({ ok: true, pages });
  } catch (err) {
    console.error('Error en /api/user/metrics:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo métricas' });
  }
});

// ================= RUTA RAÍZ PRINCIPAL =================
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`
        <!DOCTYPE html>
        <html lang="es" class="scroll-smooth">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>LandingGen — Páginas web profesionales con plantillas de alta conversión</title>
            <link rel="stylesheet" href="${MAIN_CSS_URL}">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
        </head>
        <body class="bg-slate-950 text-white flex items-center justify-center min-h-screen text-center px-4">
            <div class="space-y-6 max-w-xl bg-slate-900/80 p-8 rounded-3xl border border-slate-800 shadow-2xl backdrop-blur-md">
                <div class="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto text-2xl shadow-inner border border-indigo-500/30">
                    <i class="fa-solid fa-rocket"></i>
                </div>
                <h1 class="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">LandingGen 🚀</h1>
                <p class="text-slate-400 text-base leading-relaxed">Crea la página web de tu negocio y conéctala a WhatsApp en menos de 5 minutos con plantillas profesionales optimizadas.</p>
            </div>
        </body>
        </html>
    `);
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
                            success: `https://${MAIN_DOMAIN}/?status=success&unlocked=${finalTemplateKey}`,
                            failure: `https://${MAIN_DOMAIN}/?status=failure`,
                            pending: `https://${MAIN_DOMAIN}/?status=pending`
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
