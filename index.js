const express = require("express");
const http = require("http");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

// Configuração do servidor Express
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Estado da conexão
const connectionState = {
  status: "disconnected", // disconnected, connecting, connected
  qr: null,
  info: null,
  lastMessage: null,
};

// Configuração do cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "whatsapp-integration" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--single-process",
      "--disable-extensions"
    ],
    executablePath: process.env.CHROME_PATH || undefined,
    defaultViewport: { width: 800, height: 600 }
  },
});

// Eventos do WhatsApp
client.on("qr", async (qr) => {
  console.log("QR Code recebido, escaneie para autenticar");

  // Converter QR code para imagem base64
  try {
    const qrImage = await qrcode.toDataURL(qr);
    connectionState.qr = qrImage;
    connectionState.status = "connecting";
    io.emit("connection-update", connectionState);
  } catch (err) {
    console.error("Erro ao gerar QR code:", err);
  }
});

client.on("ready", async () => {
  console.log("Cliente WhatsApp pronto!");
  connectionState.status = "connected";
  connectionState.qr = null;

  try {
    const info = await client.getWid();
    connectionState.info = {
      number: info.user,
      name: "WhatsApp Web",
      platform: "WhatsApp Web",
    };
  } catch (err) {
    console.error("Erro ao obter informações:", err);
  }

  io.emit("connection-update", connectionState);
});

client.on("authenticated", () => {
  console.log("Autenticado com sucesso");
  connectionState.status = "authenticated";
  io.emit("connection-update", connectionState);
});

client.on("auth_failure", (error) => {
  console.error("Falha na autenticação:", error);
  connectionState.status = "disconnected";
  connectionState.error = "Falha na autenticação";
  io.emit("connection-update", connectionState);
});

client.on("disconnected", (reason) => {
  console.log("Cliente WhatsApp desconectado:", reason);
  connectionState.status = "disconnected";
  connectionState.info = null;
  io.emit("connection-update", connectionState);
});

// Sistema de resposta automática com delay e variação
client.on("message", async (message) => {
  console.log(`Mensagem recebida: ${message.body}`);
  connectionState.lastMessage = {
    from: message.from,
    body: message.body,
    timestamp: new Date().toISOString(),
  };
  io.emit("new-message", connectionState.lastMessage);

  // Ignorar mensagens de grupos e transmissões
  if (message.from.includes("g.us") || message.from.includes("broadcast")) {
    return;
  }

  // Ignorar mensagens do próprio sistema
  if (message.fromMe) {
    return;
  }

  // Adicionar delay aleatório para simular comportamento humano (1-3 segundos)
  const delay = 1000 + Math.random() * 2000;
  await new Promise((resolve) => setTimeout(resolve, delay));

  // Respostas variadas para simular comportamento humano
  const responses = [
    "Olá! Obrigado por entrar em contato. Como posso ajudar?",
    "Oi! Recebi sua mensagem. Em que posso ser útil hoje?",
    "Olá! Estou aqui para ajudar. O que você precisa?",
    "Oi! Tudo bem? Como posso te ajudar?",
  ];

  // Selecionar resposta aleatória
  const response = responses[Math.floor(Math.random() * responses.length)];

  try {
    // Enviar resposta
    await client.sendMessage(message.from, response);
    console.log(`Resposta enviada para ${message.from}: ${response}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err);
  }
});

// Rotas da API
app.get("/api/status", (req, res) => {
  res.json(connectionState);
});

app.post("/api/connect", (req, res) => {
  try {
    if (connectionState.status === "disconnected") {
      connectionState.status = "connecting";
      client.initialize();
      res.json({ success: true, message: "Iniciando conexão" });
    } else {
      res.json({ success: false, message: `Já ${connectionState.status === "connected" ? "conectado" : "conectando"}` });
    }
  } catch (err) {
    console.error("Erro ao conectar:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/disconnect", (req, res) => {
  try {
    if (connectionState.status === "connected" || connectionState.status === "connecting") {
      client.destroy();
      connectionState.status = "disconnected";
      connectionState.qr = null;
      connectionState.info = null;
      res.json({ success: true, message: "Desconectado com sucesso" });
      io.emit("connection-update", connectionState);
    } else {
      res.json({ success: false, message: "Não está conectado" });
    }
  } catch (err) {
    console.error("Erro ao desconectar:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/send-message", async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!number || !message) {
      return res.status(400).json({ success: false, error: "Número e mensagem são obrigatórios" });
    }

    if (connectionState.status !== "connected") {
      return res.status(400).json({ success: false, error: "WhatsApp não está conectado" });
    }

    // Formatar número
    const formattedNumber = number.includes("@c.us") ? number : `${number}@c.us`;

    // Enviar mensagem com delay para evitar bloqueios
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
    const result = await client.sendMessage(formattedNumber, message);

    res.json({ success: true, result });
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para verificação de saúde (health check)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Rota principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Conexão Socket.io
io.on("connection", (socket) => {
  console.log("Novo cliente conectado");
  socket.emit("connection-update", connectionState);

  socket.on("disconnect", () => {
    console.log("Cliente desconectado");
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Função para manter o aplicativo ativo no Railway
function keepAlive() {
  setInterval(() => {
    console.log("Health check - Mantendo aplicação ativa");
  }, 5 * 60 * 1000); // A cada 5 minutos
}

keepAlive();
