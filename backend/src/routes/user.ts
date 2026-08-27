import { Router, Response } from "express";
import { ALL_CHECKPOINTS } from "../models/User";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { prisma } from "../services/prisma";

const router = Router();

// All user routes require authentication
router.use(authMiddleware);

// GET /api/user/profile
router.get("/profile", async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: {
                friends: true,
            }
        });
        if (!user) return res.status(404).json({ error: "User not found" });

        return res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            college: user.college,
            avatar: user.avatar,
            checkpoints: user.checkpoints,
            friends: user.friends.map((f: any) => f.friendId),
            friendCount: user.friends.length,
            xp: user.xp,
            createdAt: user.createdAt,
        });
    } catch (err) {
        console.error("Profile error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// PUT /api/user/checkpoints — update user's interest tags
router.put("/checkpoints", async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { checkpoints } = req.body;
        if (!Array.isArray(checkpoints)) {
            return res.status(400).json({ error: "Checkpoints must be an array" });
        }

        // Validate all tags
        const valid = checkpoints.every((cp: string) => ALL_CHECKPOINTS.includes(cp));
        if (!valid) {
            return res.status(400).json({ error: "Invalid checkpoint tags" });
        }

        const user = await prisma.user.update({
            where: { id: req.userId },
            data: { checkpoints }
        });

        return res.json({
            checkpoints: user.checkpoints,
            message: "Checkpoints updated!",
        });
    } catch (err) {
        console.error("Checkpoints error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// POST /api/user/add-friend
router.post("/add-friend", async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { friendId } = req.body;
        if (!friendId) return res.status(400).json({ error: "friendId required" });

        if (friendId === req.userId) {
            return res.status(400).json({ error: "Cannot add yourself" });
        }

        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        const friend = await prisma.user.findUnique({ where: { id: friendId } });

        if (!user || !friend) return res.status(404).json({ error: "User not found" });

        // Check if already friends
        const existingFriendship = await prisma.friendship.findUnique({
            where: {
                userId_friendId: {
                    userId: req.userId,
                    friendId: friendId
                }
            }
        });
        if (existingFriendship) {
            return res.status(409).json({ error: "Already friends" });
        }

        // Create bidirectional friendship records and update XP in a transaction
        await prisma.$transaction([
            prisma.friendship.create({
                data: { userId: req.userId, friendId: friendId }
            }),
            prisma.friendship.create({
                data: { userId: friendId, friendId: req.userId }
            }),
            prisma.user.update({
                where: { id: req.userId },
                data: { xp: { increment: 10 } }
            }),
            prisma.user.update({
                where: { id: friendId },
                data: { xp: { increment: 10 } }
            })
        ]);

        // Get updated details for response
        const updatedUser = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { friends: true }
        });

        return res.json({
            message: "Friend added!",
            friendCount: updatedUser?.friends.length || 0,
            xp: updatedUser?.xp || 0,
        });
    } catch (err) {
        console.error("Add friend error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// POST /api/user/report
router.post("/report", async (req: AuthRequest, res: Response) => {
    try {
        const { reportedUserId, reason } = req.body;
        if (!reportedUserId) return res.status(400).json({ error: "reportedUserId required" });

        const reportedUser = await prisma.user.findUnique({
            where: { id: reportedUserId }
        });
        if (!reportedUser) return res.status(404).json({ error: "User not found" });

        const newReportCount = reportedUser.reportCount + 1;
        const newXp = Math.max(0, reportedUser.xp - 5);
        const isBanned = newReportCount >= 5;

        await prisma.user.update({
            where: { id: reportedUserId },
            data: {
                reportCount: newReportCount,
                xp: newXp,
                isBanned
            }
        });

        return res.json({ message: "User reported. Thank you for keeping the community safe." });
    } catch (err) {
        console.error("Report error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// GET /api/user/friends — get friend list with details
router.get("/friends", async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

        const friendships = await prisma.friendship.findMany({
            where: { userId: req.userId },
            include: {
                friend: {
                    select: {
                        id: true,
                        name: true,
                        college: true,
                        avatar: true,
                        xp: true,
                        checkpoints: true
                    }
                }
            }
        });

        const friends = friendships.map((f: any) => f.friend);
        return res.json({ friends });
    } catch (err) {
        console.error("Get friends error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

export default router;
