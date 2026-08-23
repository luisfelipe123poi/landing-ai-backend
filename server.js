const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro';

app.use(express.json());
app.use(cors());

// Base de datos temporal en memoria (puedes migrar a MongoDB o PostgreSQL más adelante)
// Estructura: users = { email: { passwordHash, plan } }
// Estructura: landings = { id: { userEmail, business, whatsapp, style, htmlContent } }
const dbUsers = {};
const dbLandings = {};

// ================= ROUTAS DE AUTENTICACIÓN =================

// Registro
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

        if (dbUsers[email]) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        dbUsers[email] = { passwordHash: hashedPassword, plan: 'free' };

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
        const user = dbUsers[email];

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

        // Aquí simularíamos o llamaríamos a OpenAI para generar la landing page HTML
        // Ejemplo de HTML generado por IA basado en los datos:
        const landingId = Math.random().toString(36.substring(2, 9));
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

        dbLandings[landingId] = { userEmail: decoded.email, business, htmlContent };

        res.json({ success: true, landingId, url: `/s/${landingId}` });
    } catch (error) {
        res.status(500).json({ error: 'Error al generar la landing' });
    }
});

// Ruta pública para servir la landing creada
app.get('/s/:id', (req, res) => {
    const landing = dbLandings[req.params.id];
    if (!landing) return res.status(404).send('Página no encontrada');
    res.send(landing.htmlContent);
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});