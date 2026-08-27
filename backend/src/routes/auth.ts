import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { ALLOWED_DOMAINS, COLLEGE_NAMES, ALL_CHECKPOINTS } from "../models/User";
import { prisma } from "../services/prisma";
import { sendResetEmail } from "../services/email";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
    try {
        const { email, password, name, avatar } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: "Email, password, and name are required" });
        }

        // Validate college email domain
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
            return res.status(403).json({
                error: "ACCESS DENIED! Only approved college email IDs are allowed.",
                allowedDomains: ALLOWED_DOMAINS,
            });
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        if (existingUser) {
            return res.status(409).json({ error: "User with this email already exists" });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Get college name from domain
        const college = COLLEGE_NAMES[domain] || domain;

        // Create user in PostgreSQL via Prisma
        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                password: hashedPassword,
                name,
                college,
                avatar: avatar || "male",
            }
        });

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET || "fallback_secret",
            { expiresIn: "7d" }
        );

        return res.status(201).json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                college: user.college,
                avatar: user.avatar,
                checkpoints: user.checkpoints,
                friendCount: 0, // new user has no friends
                xp: user.xp,
            },
        });
    } catch (err) {
        console.error("Register error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        // Validate domain
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
            return res.status(403).json({
                error: "ACCESS DENIED! Only approved college email IDs are allowed.",
            });
        }

        // Find user in PostgreSQL via Prisma
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            include: {
                friends: true, // we can get friend count
            }
        });
        if (!user) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // Check ban
        if (user.isBanned) {
            return res.status(403).json({ error: "Your account has been suspended due to reports." });
        }

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET || "fallback_secret",
            { expiresIn: "7d" }
        );

        return res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                college: user.college,
                avatar: user.avatar,
                checkpoints: user.checkpoints,
                friendCount: user.friends.length,
                xp: user.xp,
            },
        });
    } catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// GET /api/auth/checkpoints — list all available checkpoints
router.get("/checkpoints", (_req: Request, res: Response) => {
    return res.json({ checkpoints: ALL_CHECKPOINTS });
});

// GET /api/auth/domains — list all allowed college domains
router.get("/domains", (_req: Request, res: Response) => {
    return res.json({
        domains: ALLOWED_DOMAINS,
        colleges: COLLEGE_NAMES,
    });
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        if (!user) {
            // To prevent user enumeration attacks, we still return success but don't send an email.
            return res.json({ message: "If a matching email exists, a reset link has been sent." });
        }

        // Generate reset token and expiration (1 hour)
        const token = crypto.randomBytes(32).toString("hex");
        const expires = new Date(Date.now() + 3600000); // 1 hour from now

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken: token,
                resetTokenExpires: expires
            }
        });

        // Dispatch email
        await sendResetEmail(user.email, token);

        return res.json({ message: "If a matching email exists, a reset link has been sent." });
    } catch (err) {
        console.error("Forgot password error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req: Request, res: Response) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ error: "Token and password are required" });
        }

        const user = await prisma.user.findUnique({
            where: { resetToken: token }
        });

        // Validate token existence and expiration
        if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
            return res.status(400).json({ error: "Invalid or expired reset token" });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update password and clear reset token
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetToken: null,
                resetTokenExpires: null
            }
        });

        return res.json({ message: "Password reset successful! You can now log in." });
    } catch (err) {
        console.error("Reset password error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

export default router;
