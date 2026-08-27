import { Socket, Server } from "socket.io";
import { RoomManager, RoomMember, Room } from "./RoomManager";
import { redis } from "../services/redis";

export class UserManager {
    private io: Server;
    private roomManager: RoomManager;
    private localSockets: Map<string, Socket>; // local sockets connected to this instance

    constructor(io: Server) {
        this.io = io;
        this.roomManager = new RoomManager(io);
        this.localSockets = new Map();
    }

    async addUser(name: string, socket: Socket, userId?: string, checkpoints?: string[]) {
        const socketId = socket.id;
        
        // Save socket locally
        this.localSockets.set(socketId, socket);

        // Save user metadata in Redis (expires in 1 hour if not cleaned up)
        const userMeta = {
            socketId,
            name,
            userId,
            checkpoints: checkpoints || [],
        };
        await redis.set(`user:meta:${socketId}`, JSON.stringify(userMeta), "EX", 3600);

        // Add to Redis lobby queue Set
        await redis.sadd("lobby:queue", socketId);
        
        console.log(`[UserManager] User joined: ${name} (Socket: ${socketId})`);
        
        socket.emit("lobby");
        
        // Trigger matchmaking
        await this.clearQueue();
        
        this.initHandlers(socket);
    }

    async removeUser(socketId: string) {
        // Remove local socket cache
        this.localSockets.delete(socketId);

        // Remove from Redis lobby queue Set
        await redis.srem("lobby:queue", socketId);

        // Delete user metadata
        await redis.del(`user:meta:${socketId}`);

        // Handle room cleanup and notify remaining group members
        const roomId = await redis.get(`user:room:${socketId}`);
        if (roomId) {
            await redis.del(`user:room:${socketId}`);
            const room = await this.roomManager.getRoom(roomId);
            if (room) {
                // Filter out disconnected user
                room.members = room.members.filter(m => m.socketId !== socketId);
                
                if (room.members.length > 0) {
                    await this.roomManager.saveRoom(room);
                    // Broadcast peer departure to remaining members
                    room.members.forEach(member => {
                        this.io.to(member.socketId).emit("peer-left-group", {
                            roomId,
                            socketId,
                        });
                    });
                } else {
                    // Delete empty room
                    await this.roomManager.deleteRoom(roomId);
                }
            }
        }

        console.log(`[UserManager] User left: ${socketId}`);
    }

    // Helper to calculate matching score
    private getMatchScore(checkpoints1: string[], checkpoints2: string[]): number {
        if (!checkpoints1.length || !checkpoints2.length) return 0;
        const shared = checkpoints1.filter(cp => checkpoints2.includes(cp));
        return shared.length;
    }

    // Matchmaking queue clear loop
    async clearQueue() {
        console.log("[UserManager] Clearing matchmaking queue...");
        
        // Fetch all socket IDs in queue
        const queueSocketIds = await redis.smembers("lobby:queue");
        console.log(`[UserManager] Active users in queue: ${queueSocketIds.length}`);

        if (queueSocketIds.length < 2) return;

        // Fetch metadata for all queued users
        const pipeline = redis.pipeline();
        queueSocketIds.forEach(id => pipeline.get(`user:meta:${id}`));
        const results = await pipeline.exec();

        const queueUsers: any[] = [];
        results?.forEach((res, index) => {
            const err = res[0];
            const data = res[1];
            if (!err && data) {
                try {
                    queueUsers.push(JSON.parse(data as string));
                } catch {}
            }
        });

        if (queueUsers.length < 2) return;

        // Find the best match pair based on checkpoints
        let bestPairIdx1 = -1;
        let bestPairIdx2 = -1;
        let bestScore = -1;

        for (let i = 0; i < queueUsers.length; i++) {
            for (let j = i + 1; j < queueUsers.length; j++) {
                const score = this.getMatchScore(queueUsers[i].checkpoints, queueUsers[j].checkpoints);
                if (score > bestScore) {
                    bestScore = score;
                    bestPairIdx1 = i;
                    bestPairIdx2 = j;
                }
            }
        }

        // Fallback to FIFO (first two users) if no matches found
        if (bestScore <= 0) {
            bestPairIdx1 = 0;
            bestPairIdx2 = 1;
        }

        const user1 = queueUsers[bestPairIdx1];
        const user2 = queueUsers[bestPairIdx2];

        // Lua script to atomically remove both users from queue to avoid double matching
        const sremLua = `
            if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 and redis.call('SISMEMBER', KEYS[1], ARGV[2]) == 1 then
                redis.call('SREM', KEYS[1], ARGV[1], ARGV[2])
                return 1
            else
                return 0
            end
        `;

        const matched = await redis.eval(
            sremLua,
            1,
            "lobby:queue",
            user1.socketId,
            user2.socketId
        );

        if (matched !== 1) {
            // One or both users were already matched or disconnected
            console.log(`[UserManager] Match failed for ${user1.socketId} and ${user2.socketId} (race condition)`);
            return;
        }

        console.log(`[UserManager] Matched ${user1.name} and ${user2.name} (Score: ${bestScore})`);

        const shared = user1.checkpoints.filter((cp: string) => user2.checkpoints.includes(cp));
        const maxCheckpoints = Math.max(user1.checkpoints.length, user2.checkpoints.length);
        const matchPercentage = maxCheckpoints > 0 ? Math.round((shared.length / maxCheckpoints) * 100) : 0;

        await this.roomManager.createRoom(
            { socketId: user1.socketId, name: user1.name, userId: user1.userId },
            { socketId: user2.socketId, name: user2.name, userId: user2.userId },
            shared,
            matchPercentage
        );

        // Check queue again if there are still users waiting
        await this.clearQueue();
    }

    // Match a single user from the queue for an existing group room
    async findGroupPeer(room: Room): Promise<any | null> {
        const queueSocketIds = await redis.smembers("lobby:queue");
        if (queueSocketIds.length === 0) return null;

        // Fetch metadata for all queued users
        const pipeline = redis.pipeline();
        queueSocketIds.forEach(id => pipeline.get(`user:meta:${id}`));
        const results = await pipeline.exec();

        const queueUsers: any[] = [];
        results?.forEach((res) => {
            const err = res[0];
            const data = res[1];
            if (!err && data) {
                try {
                    queueUsers.push(JSON.parse(data as string));
                } catch {}
            }
        });

        if (queueUsers.length === 0) return null;

        // Find the user with the best checkpoint score match with the room's current checkpoints
        let bestUserIdx = 0;
        let bestScore = -1;

        queueUsers.forEach((user, idx) => {
            const score = this.getMatchScore(user.checkpoints, room.sharedCheckpoints);
            if (score > bestScore) {
                bestScore = score;
                bestUserIdx = idx;
            }
        });

        const selectedUser = queueUsers[bestUserIdx];

        // Lua script to atomically remove this single user from the queue
        const sremLua = `
            if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
                redis.call('SREM', KEYS[1], ARGV[1])
                return 1
            else
                return 0
            end
        `;

        const matched = await redis.eval(
            sremLua,
            1,
            "lobby:queue",
            selectedUser.socketId
        );

        if (matched !== 1) {
            // Already matched by another process
            return null;
        }

        return selectedUser;
    }

    initHandlers(socket: Socket) {
        socket.on("offer", ({ sdp, roomId, targetSocketId }: { sdp: any, roomId: string, targetSocketId: string }) => {
            this.roomManager.onOffer(roomId, sdp, socket.id, targetSocketId);
        });

        socket.on("answer", ({ sdp, roomId, targetSocketId }: { sdp: any, roomId: string, targetSocketId: string }) => {
            this.roomManager.onAnswer(roomId, sdp, socket.id, targetSocketId);
        });

        socket.on("add-ice-candidate", ({ candidate, roomId, targetSocketId }: { candidate: any, roomId: string, targetSocketId: string }) => {
            this.roomManager.onIceCandidates(roomId, socket.id, candidate, targetSocketId);
        });

        socket.on("chat-message", ({ roomId, sender, text }: { roomId: string, sender: string, text: string }) => {
            this.roomManager.onChatMessage(roomId, socket.id, sender, text);
        });

        // Dynamic checkpoint updates
        socket.on("update-checkpoints", async ({ checkpoints }: { checkpoints: string[] }) => {
            const data = await redis.get(`user:meta:${socket.id}`);
            if (data) {
                const userMeta = JSON.parse(data);
                userMeta.checkpoints = checkpoints;
                await redis.set(`user:meta:${socket.id}`, JSON.stringify(userMeta), "EX", 3600);
            }
        });

        // GROUP CALL INVITE PEER PROCESS: Step 1: Request Vote
        socket.on("invite-peer-request", async ({ roomId }: { roomId: string }) => {
            const room = await this.roomManager.getRoom(roomId);
            if (!room) return;

            if (room.members.length >= 5) {
                socket.emit("invite-peer-error", { error: "Room is already full! (Max 5 users)" });
                return;
            }

            // Find name of requester
            const requester = room.members.find(m => m.socketId === socket.id);
            const requesterName = requester ? requester.name : "Your partner";

            // Reset votes
            room.votes = {};
            // Requester implicitly votes yes
            room.votes[socket.id] = true;

            await this.roomManager.saveRoom(room);

            // Ask all other members in the room to vote
            room.members.forEach(member => {
                if (member.socketId !== socket.id) {
                    this.io.to(member.socketId).emit("invite-peer-vote-prompt", {
                        roomId,
                        requesterName,
                    });
                }
            });
        });

        // GROUP CALL INVITE PEER PROCESS: Step 2: Handle Vote Response
        socket.on("invite-peer-vote", async ({ roomId, agree }: { roomId: string, agree: boolean }) => {
            const room = await this.roomManager.getRoom(roomId);
            if (!room) return;

            // Record vote
            room.votes[socket.id] = agree;
            await this.roomManager.saveRoom(room);

            // If anyone declines, vote fails immediately
            if (!agree) {
                // Notify all members that the vote was rejected
                room.members.forEach(member => {
                    this.io.to(member.socketId).emit("invite-peer-vote-failed", {
                        reason: "A member declined the request to add another peer."
                    });
                });
                return;
            }

            // Check if all other members have voted and agreed
            const allAgreed = room.members.every(member => room.votes[member.socketId] === true);
            
            if (allAgreed) {
                // Everyone agreed! Try to find a new peer in the queue
                const newPeer = await this.findGroupPeer(room);

                if (!newPeer) {
                    // No one in queue
                    room.members.forEach(member => {
                        this.io.to(member.socketId).emit("invite-peer-vote-failed", {
                            reason: "Lobby queue is empty. No online users matched."
                        });
                    });
                    return;
                }

                // Add peer to room state
                const newMember: RoomMember = {
                    socketId: newPeer.socketId,
                    userId: newPeer.userId,
                    name: newPeer.name,
                };
                
                room.members.push(newMember);
                room.votes = {}; // Reset votes
                await this.roomManager.saveRoom(room);
                await redis.set(`user:room:${newMember.socketId}`, roomId, "EX", 86400);

                console.log(`[UserManager] Group Room ${roomId} expanded: added user ${newMember.name}`);

                // 1. Tell existing members that a new peer has joined
                room.members.forEach(member => {
                    if (member.socketId !== newMember.socketId) {
                        this.io.to(member.socketId).emit("peer-joined-group", {
                            roomId,
                            newMember,
                        });
                    }
                });

                // 2. Tell the new member they joined a group room and send them current members
                this.io.to(newMember.socketId).emit("joined-group-room", {
                    roomId,
                    members: room.members,
                    checkpoints: room.sharedCheckpoints,
                });
            }
        });
    }
}