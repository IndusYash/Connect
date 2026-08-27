import dotenv from "dotenv";
dotenv.config();

import { Socket } from "socket.io";
import http from "http";
import express from 'express';
import { Server } from 'socket.io';
import cors from "cors";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";

import { UserManager } from "./managers/UserManger";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import { prisma } from "./services/prisma";

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());

// REST API routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// Health check
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", message: "MINI API is running 🕹️" });
});

// Configure Socket.io Server
const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

// Configure Socket.io Redis Adapter for horizontal scaling
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const pubClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));

pubClient.on("connect", () => console.log("✅ Socket.io Redis Pub client connected"));
subClient.on("connect", () => console.log("✅ Socket.io Redis Sub client connected"));

const userManager = new UserManager(io);

io.on('connection', (socket: Socket) => {
    console.log('a user connected');

    // Listen for user joining with their info
    socket.on("join", ({ name, userId, checkpoints }: { name: string, userId?: string, checkpoints?: string[] }) => {
        userManager.addUser(name, socket, userId, checkpoints);
    });

    // Fallback: if no join event, add as anonymous after 3 seconds
    const joinTimeout = setTimeout(async () => {
        const metadata = await pubClient.get(`user:meta:${socket.id}`);
        if (!metadata) {
            userManager.addUser("Anonymous", socket);
        }
    }, 3000);

    socket.on("disconnect", () => {
        clearTimeout(joinTimeout);
        console.log("user disconnected");
        userManager.removeUser(socket.id);
    })
});

// Connect to database and start server
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL Database via Prisma");
    } catch (err: any) {
        console.error("❌ PostgreSQL connection failed:", err.message);
        process.exit(1);
    }

    server.listen(PORT, () => {
        console.log(`🕹️  MINI server listening on *:${PORT}`);
    });
}

startServer();