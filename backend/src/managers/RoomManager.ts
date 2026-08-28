import { Server } from "socket.io";
import { redis } from "../services/redis";

export interface RoomMember {
    socketId: string;
    userId?: string;
    name: string;
}

export interface Room {
    id: string;
    members: RoomMember[];
    sharedCheckpoints: string[];
    matchPercentage: number;
    votes: Record<string, boolean>; // maps socketId -> vote (true = agree, false = disagree)
}

export class RoomManager {
    private io: Server;
    
    constructor(io: Server) {
        this.io = io;
    }

    // Helper to get room from Redis
    async getRoom(roomId: string): Promise<Room | null> {
        const data = await redis.get(`room:${roomId}`);
        if (!data) return null;
        try {
            return JSON.parse(data) as Room;
        } catch {
            return null;
        }
    }

    // Helper to save room to Redis
    async saveRoom(room: Room): Promise<void> {
        // Expire room after 24 hours of inactivity
        await redis.set(`room:${room.id}`, JSON.stringify(room), "EX", 86400);
    }

    // Helper to delete room from Redis
    async deleteRoom(roomId: string): Promise<void> {
        await redis.del(`room:${roomId}`);
    }

    async createRoom(
        member1: RoomMember,
        member2: RoomMember,
        sharedCheckpoints: string[] = [],
        matchPercentage: number = 0
    ): Promise<string> {
        // Generate unique room ID
        const roomId = `room_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        
        const room: Room = {
            id: roomId,
            members: [member1, member2],
            sharedCheckpoints,
            matchPercentage,
            votes: {},
        };

        await this.saveRoom(room);

        // Track user's active room in Redis
        await redis.set(`user:room:${member1.socketId}`, roomId, "EX", 86400);
        await redis.set(`user:room:${member2.socketId}`, roomId, "EX", 86400);

        console.log(`[RoomManager] Room ${roomId} created with ${member1.name} and ${member2.name}`);

        // Member 1 initiates the WebRTC offer; Member 2 waits
        this.io.to(member1.socketId).emit("send-offer", {
            roomId,
            targetSocketId: member2.socketId,
            matchInfo: {
                peerName: member2.name,
                peerId: member2.userId,
                sharedCheckpoints,
                matchPercentage,
            }
        });

        this.io.to(member2.socketId).emit("waiting-for-offer", {
            roomId,
            matchInfo: {
                peerName: member1.name,
                peerId: member1.userId,
                sharedCheckpoints,
                matchPercentage,
            }
        });

        return roomId;
    }

    async onOffer(roomId: string, sdp: any, senderSocketId: string, targetSocketId: string) {
        const room = await this.getRoom(roomId);
        if (!room) return;

        console.log(`[RoomManager] Forwarding offer from ${senderSocketId} to target ${targetSocketId}`);
        this.io.to(targetSocketId).emit("offer", {
            sdp,
            roomId,
            senderSocketId,
        });
    }
    
    async onAnswer(roomId: string, sdp: any, senderSocketId: string, targetSocketId: string) {
        const room = await this.getRoom(roomId);
        if (!room) return;

        console.log(`[RoomManager] Forwarding answer from ${senderSocketId} to target ${targetSocketId}`);
        this.io.to(targetSocketId).emit("answer", {
            sdp,
            roomId,
            senderSocketId,
        });
    }

    async onIceCandidates(roomId: string, senderSocketId: string, candidate: any, targetSocketId: string) {
        const room = await this.getRoom(roomId);
        if (!room) return;

        this.io.to(targetSocketId).emit("add-ice-candidate", {
            candidate,
            senderSocketId,
            roomId,
        });
    }

    async onChatMessage(roomId: string, senderSocketId: string, sender: string, text: string) {
        const room = await this.getRoom(roomId);
        if (!room) return;

        // Broadcast chat message to all other members in the room
        room.members.forEach(member => {
            if (member.socketId !== senderSocketId) {
                this.io.to(member.socketId).emit("chat-message", { sender, text, senderSocketId });
            }
        });
    }
}