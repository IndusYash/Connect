import { useEffect, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";
import { apiAddFriend, apiReport } from "../api";
import "./Room.css";

const URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

const EMOJI_LIST = [
    "😀","😂","😍","🤩","😎","🥳","🤪","😜",
    "👋","✌️","🤟","👍","👏","🙌","🤝","💪",
    "❤️","🔥","⭐","✨","💫","🎮","🕹️","🎯",
    "🎉","🎊","💬","🗨️","💡","🚀","⚡","🌟",
    "😈","👻","💀","👾","🤖","👽","🎃","🦄",
];

interface ChatMessage {
    id: string;
    sender: string;
    text: string;
    isSelf: boolean;
    isSystem?: boolean;
    timestamp: number;
}

interface MatchInfo {
    peerName: string;
    peerId?: string;
    sharedCheckpoints: string[];
    matchPercentage: number;
}

interface RemotePeer {
    name: string;
    stream: MediaStream;
}

const VideoCard = ({ name, stream, index }: { name: string, stream: MediaStream, index: number }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(err => console.error("Remote video play failed:", err));
        }
    }, [stream]);

    return (
        <div className="video-card remote">
            <div className="video-card-label">
                <span className="player-badge">{`[P${index}]`}</span>
                {`PLAYER ${index} — ${name}`}
            </div>
            <div className="video-display">
                <video autoPlay playsInline ref={videoRef} />
            </div>
        </div>
    );
};

export const Room = ({
    name,
    localAudioTrack,
    localVideoTrack,
    userCheckpoints,
    userId,
}: {
    name: string,
    localAudioTrack: MediaStreamTrack | null,
    localVideoTrack: MediaStreamTrack | null,
    userCheckpoints?: string[],
    userId?: string,
}) => {
    const [lobby, setLobby] = useState(true);
    const [socket, setSocket] = useState<null | Socket>(null);
    
    // Multi-peer WebRTC connections map: remoteSocketId -> RTCPeerConnection
    const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    
    // State of active remote peers: remoteSocketId -> RemotePeer
    const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeer>>(new Map());
    
    const localVideoRef = useRef<HTMLVideoElement>(null);

    // Chat state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [showEmoji, setShowEmoji] = useState(false);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Match & Invite state
    const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
    const [friendAdded, setFriendAdded] = useState(false);
    const [reported, setReported] = useState(false);
    const [showReportModal, setShowReportModal] = useState(false);
    const [votePrompt, setVotePrompt] = useState<{ roomId: string; requesterName: string } | null>(null);

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        const socketInstance = io(URL);

        const iceServers: RTCConfiguration = {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
                { urls: "stun:stun2.l.google.com:19302" },
                {
                    urls: "turn:openrelay.metered.ca:80",
                    username: "openrelayproject",
                    credential: "openrelayproject",
                },
                {
                    urls: "turn:openrelay.metered.ca:443",
                    username: "openrelayproject",
                    credential: "openrelayproject",
                },
            ],
        };

        // Helper: setup peer connection and tracks
        const createPeerConnection = (roomId: string, targetSocketId: string, peerName: string): RTCPeerConnection => {
            console.log(`[WebRTC] Creating PC for target ${targetSocketId} (${peerName})`);
            const pc = new RTCPeerConnection(iceServers);
            
            // Add local tracks
            if (localVideoTrack) pc.addTrack(localVideoTrack);
            if (localAudioTrack) pc.addTrack(localAudioTrack);

            // Handle candidate generation
            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socketInstance.emit("add-ice-candidate", {
                        candidate: e.candidate,
                        roomId,
                        targetSocketId,
                    });
                }
            };

            // Handle remote track arriving
            const remoteStream = new MediaStream();
            pc.ontrack = (event) => {
                console.log(`[WebRTC] Track arrived from ${targetSocketId} (${event.track.kind})`);
                remoteStream.addTrack(event.track);
                setRemotePeers(prev => {
                    const next = new Map(prev);
                    next.set(targetSocketId, { name: peerName, stream: remoteStream });
                    return next;
                });
            };

            pcsRef.current.set(targetSocketId, pc);
            return pc;
        };

        socketInstance.emit("join", {
            name,
            userId,
            checkpoints: userCheckpoints || [],
        });

        // --- 1. Offerer role: first pair setup ---
        socketInstance.on('send-offer', async ({ roomId, matchInfo: mi }) => {
            console.log("[Lobby] Starting 1v1 call as Offerer");
            setLobby(false);
            setCurrentRoomId(roomId);
            if (mi) setMatchInfo(mi);

            addSystemMessage("Connected! Say hi");
            if (mi?.sharedCheckpoints?.length > 0) {
                addSystemMessage(`Vibe Match: ${mi.matchPercentage}% — You both like: ${mi.sharedCheckpoints.join(", ")}`);
            }

            // In 1v1 matching, the server assigns roles. We find the peer metadata
            // Note: Since we matched 1v1, the target socket is the only other member.
            // We wait for negotiationneeded to trigger the offer.
        });

        // --- 2. Answerer role: first pair setup ---
        socketInstance.on('waiting-for-offer', ({ matchInfo: mi }) => {
            console.log("[Lobby] Starting 1v1 call as Answerer");
            setLobby(false);
            if (mi) setMatchInfo(mi);

            addSystemMessage("Connected! Say hi");
            if (mi?.sharedCheckpoints?.length > 0) {
                addSystemMessage(`Vibe Match: ${mi.matchPercentage}% — You both like: ${mi.sharedCheckpoints.join(", ")}`);
            }
        });

        // --- 3. Receive Offer ---
        socketInstance.on("offer", async ({ roomId, sdp: remoteSdp, senderSocketId }) => {
            console.log(`[Signaling] Received offer from ${senderSocketId}`);
            setLobby(false);
            setCurrentRoomId(roomId);

            // Find name of sender from matchInfo or set default
            const peerName = matchInfo?.peerName || "Player";
            
            const pc = createPeerConnection(roomId, senderSocketId, peerName);
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
            
            const sdp = await pc.createAnswer();
            await pc.setLocalDescription(sdp);

            socketInstance.emit("answer", {
                roomId,
                sdp,
                targetSocketId: senderSocketId,
            });
        });

        // --- 4. Receive Answer ---
        socketInstance.on("answer", async ({ sdp: remoteSdp, senderSocketId }) => {
            console.log(`[Signaling] Received answer from ${senderSocketId}`);
            const pc = pcsRef.current.get(senderSocketId);
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
            }
        });

        // --- 5. Receive ICE Candidate ---
        socketInstance.on("add-ice-candidate", ({ candidate, senderSocketId }) => {
            const pc = pcsRef.current.get(senderSocketId);
            if (pc) {
                pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
            }
        });

        // --- 6. Group Setup: Joining existing room ---
        socketInstance.on("joined-group-room", async ({ roomId, members, checkpoints }) => {
            console.log(`[Group] Joined active room ${roomId} with ${members.length} members`);
            setLobby(false);
            setCurrentRoomId(roomId);

            addSystemMessage("You joined the group call!");
            
            // This joining user acts as the offerer to all current room members
            for (const member of members) {
                if (member.socketId !== socketInstance.id) {
                    const pc = createPeerConnection(roomId, member.socketId, member.name);
                    
                    // Create and send offer
                    const sdp = await pc.createOffer();
                    await pc.setLocalDescription(sdp);
                    
                    socketInstance.emit("offer", {
                        sdp,
                        roomId,
                        targetSocketId: member.socketId,
                    });
                }
            }
        });

        // --- 7. Group Setup: Existing member hears someone joined ---
        socketInstance.on("peer-joined-group", ({ roomId, newMember }) => {
            console.log(`[Group] Peer joined group: ${newMember.name} (${newMember.socketId})`);
            addSystemMessage(`${newMember.name} joined the call!`);
            
            // We just wait for their offer. No connection creation here yet!
        });

        // --- 8. Peer Left Group ---
        socketInstance.on("peer-left-group", ({ socketId }) => {
            console.log(`[Group] Peer left call: ${socketId}`);
            
            const pc = pcsRef.current.get(socketId);
            if (pc) {
                pc.close();
                pcsRef.current.delete(socketId);
            }

            setRemotePeers(prev => {
                const next = new Map(prev);
                const peerInfo = next.get(socketId);
                if (peerInfo) {
                    addSystemMessage(`${peerInfo.name} left the call.`);
                }
                next.delete(socketId);
                return next;
            });
        });

        // --- 9. Group Invite Vote Prompt ---
        socketInstance.on("invite-peer-vote-prompt", ({ roomId, requesterName }) => {
            setVotePrompt({ roomId, requesterName });
        });

        // --- 10. Lobby fallback ---
        socketInstance.on("lobby", () => {
            setLobby(true);
        });

        // --- 11. Chat Message ---
        socketInstance.on("chat-message", ({ sender, text }) => {
            const msg: ChatMessage = {
                id: `${Date.now()}-${Math.random()}`,
                sender,
                text,
                isSelf: false,
                timestamp: Date.now(),
            };
            setMessages(prev => [...prev, msg]);
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
            // Close all connections on unmount
            pcsRef.current.forEach(pc => pc.close());
            pcsRef.current.clear();
        };
    }, [name]);

    // Local stream render
    useEffect(() => {
        if (localVideoRef.current && localVideoTrack) {
            localVideoRef.current.srcObject = new MediaStream([localVideoTrack]);
            localVideoRef.current.play().catch(err => console.error("Local video play failed:", err));
        }
    }, [localVideoTrack]);

    const addSystemMessage = (text: string) => {
        setMessages(prev => [...prev, {
            id: `sys-${Date.now()}-${Math.random()}`,
            sender: "SYSTEM",
            text,
            isSelf: false,
            isSystem: true,
            timestamp: Date.now(),
        }]);
    };

    const sendMessage = () => {
        const text = chatInput.trim();
        if (!text || !socket || !currentRoomId) return;

        const msg: ChatMessage = {
            id: `${Date.now()}-${Math.random()}`,
            sender: name || "PLAYER 1",
            text,
            isSelf: true,
            timestamp: Date.now(),
        };
        setMessages(prev => [...prev, msg]);

        socket.emit("chat-message", {
            roomId: currentRoomId,
            sender: name || "PLAYER 1",
            text,
        });

        setChatInput("");
        setShowEmoji(false);
    };

    const handleEmojiClick = (emoji: string) => {
        setChatInput(prev => prev + emoji);
    };

    const handleSkip = () => {
        if (socket) {
            socket.disconnect();
        }
        window.location.reload();
    };

    const handleAddFriend = async () => {
        if (!matchInfo?.peerId || friendAdded) return;
        try {
            await apiAddFriend(matchInfo.peerId);
            setFriendAdded(true);
            addSystemMessage("Friend request sent! +10 XP");
        } catch (err: any) {
            addSystemMessage(`Error: ${err.message}`);
        }
    };

    const handleReport = async (reason: string) => {
        if (!matchInfo?.peerId || reported) return;
        try {
            await apiReport(matchInfo.peerId, reason);
            setReported(true);
            setShowReportModal(false);
            addSystemMessage("User reported. Thank you for keeping the community safe.");
        } catch (err: any) {
            addSystemMessage(`Error: ${err.message}`);
        }
    };

    // Trigger inviting a peer
    const handleInvitePeer = () => {
        if (!socket || !currentRoomId) return;
        if (remotePeers.size >= 4) {
            addSystemMessage("Call is full! (Max 5 people)");
            return;
        }
        socket.emit("invite-peer-request", { roomId: currentRoomId });
        addSystemMessage("Vote started to invite a new peer...");
    };

    // Cast vote for invite
    const handleVote = (agree: boolean) => {
        if (!socket || !votePrompt) return;
        socket.emit("invite-peer-vote", {
            roomId: votePrompt.roomId,
            agree,
        });
        setVotePrompt(null);
    };

    return (
        <div className="room-wrapper">
            <div className="crt-overlay" />

            {/* Report Modal */}
            {showReportModal && (
                <div className="report-modal-overlay" onClick={() => setShowReportModal(false)}>
                    <div className="report-modal" onClick={e => e.stopPropagation()}>
                        <h3 className="report-modal-title">REPORT USER</h3>
                        <p className="report-modal-text">SELECT A REASON:</p>
                        <div className="report-options">
                            {["Inappropriate behavior", "Harassment", "Spam", "Other"].map(reason => (
                                <button
                                    key={reason}
                                    className="report-option-btn"
                                    onClick={() => handleReport(reason)}
                                >
                                    {reason}
                                </button>
                            ))}
                        </div>
                        <button className="report-cancel-btn" onClick={() => setShowReportModal(false)}>
                            CANCEL
                        </button>
                    </div>
                </div>
            )}

            {/* Invite Voting Prompt */}
            {votePrompt && (
                <div className="vote-modal-overlay">
                    <div className="vote-modal">
                        <h3 className="vote-modal-title">NEW PEER VOTE</h3>
                        <p className="vote-modal-text">
                            {`${votePrompt.requesterName} wants to invite another peer to this call.`}
                        </p>
                        <p className="vote-modal-question">DO YOU AGREE?</p>
                        <div className="vote-options">
                            <button className="vote-btn yes" onClick={() => handleVote(true)}>
                                [YES] AGREE
                            </button>
                            <button className="vote-btn no" onClick={() => handleVote(false)}>
                                [NO] DECLINE
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="room-header">
                <div className="room-logo">
                    <span className="logo-friend">MINI</span>
                </div>

                {matchInfo && !lobby && (
                    <div className="match-info-badge">
                        <span className="match-percent">{matchInfo.matchPercentage}%</span>
                        <span className="match-label">VIBE</span>
                    </div>
                )}

                <div className="room-status">
                    {lobby ? (
                        <div className="status-badge waiting">
                            <span className="status-dot yellow" />
                            MATCHING...
                        </div>
                    ) : (
                        <div className="status-badge connected">
                            <span className="status-dot green" />
                            CONNECTED ({remotePeers.size + 1}/5)
                        </div>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="room-body">
                <div className="video-section">
                    <div className={`video-grid count-${remotePeers.size + 1}`}>
                        {/* Local Video */}
                        <div className="video-card self">
                            <div className="video-card-label">
                                <span className="player-badge">[P1]</span>
                                PLAYER 1 — {name} (YOU)
                            </div>
                            <div className="video-display">
                                <video autoPlay muted playsInline ref={localVideoRef} />
                            </div>
                        </div>

                        {/* Remote Videos */}
                        {Array.from(remotePeers.entries()).map(([socketId, peer], index) => (
                            <VideoCard
                                key={socketId}
                                name={peer.name}
                                stream={peer.stream}
                                index={index + 2}
                            />
                        ))}

                        {/* Waiting Placeholder (only in lobby) */}
                        {lobby && (
                            <div className="video-card remote">
                                <div className="video-card-label">
                                    <span className="player-badge">[P2]</span>
                                    PLAYER 2
                                </div>
                                <div className="video-display">
                                    <div className="waiting-overlay">
                                        <div className="waiting-pixel-art">?</div>
                                        <div className="waiting-text">
                                            WAITING FOR<br />PARTNERS...
                                        </div>
                                        <div className="waiting-spinner">
                                            <div className="waiting-spinner-dot" />
                                            <div className="waiting-spinner-dot" />
                                            <div className="waiting-spinner-dot" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* In-Call Controls */}
                    {!lobby && (
                        <div className="call-controls">
                            <button
                                className="control-btn skip"
                                onClick={handleSkip}
                                title="Skip to next person"
                            >
                                <span className="control-icon">[&gt;&gt;]</span>
                                <span className="control-label">SKIP</span>
                            </button>
                            {remotePeers.size < 4 && (
                                <button
                                    className="control-btn invite"
                                    onClick={handleInvitePeer}
                                    title="Invite another peer to the call"
                                >
                                    <span className="control-icon">[+]</span>
                                    <span className="control-label">INVITE PEER</span>
                                </button>
                            )}
                            {remotePeers.size === 1 && (
                                <button
                                    className={`control-btn friend ${friendAdded ? 'done' : ''}`}
                                    onClick={handleAddFriend}
                                    disabled={friendAdded || !matchInfo?.peerId}
                                    title="Add partner as friend"
                                >
                                    <span className="control-icon">{friendAdded ? '[OK]' : '[+]'}</span>
                                    <span className="control-label">{friendAdded ? 'ADDED' : 'ADD FRIEND'}</span>
                                </button>
                            )}
                            {remotePeers.size === 1 && (
                                <button
                                    className={`control-btn report ${reported ? 'done' : ''}`}
                                    onClick={() => setShowReportModal(true)}
                                    disabled={reported}
                                    title="Report user"
                                >
                                    <span className="control-icon">{reported ? '[OK]' : '[!]'}</span>
                                    <span className="control-label">{reported ? 'REPORTED' : 'FLAG'}</span>
                                </button>
                            )}
                        </div>
                    )}

                    {/* Shared Checkpoints */}
                    {matchInfo?.sharedCheckpoints && matchInfo.sharedCheckpoints.length > 0 && !lobby && (
                        <div className="shared-tags">
                            <span className="shared-tags-label">SHARED VIBES:</span>
                            {matchInfo.sharedCheckpoints.map(cp => (
                                <span key={cp} className="shared-tag">{cp}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Chat Panel */}
                <div className="chat-panel">
                    <div className="chat-header">
                        <span className="chat-header-icon">[MSG]</span>
                        CHAT
                    </div>

                    <div className="chat-messages">
                        {messages.length === 0 ? (
                            <div className="chat-empty">
                                <div className="chat-empty-icon">...</div>
                                <div className="chat-empty-text">
                                    NO MESSAGES YET<br />
                                    SAY SOMETHING
                                </div>
                            </div>
                        ) : (
                            messages.map(msg =>
                                msg.isSystem ? (
                                    <div key={msg.id} className="chat-msg-system">
                                        &gt; {msg.text}
                                    </div>
                                ) : (
                                    <div key={msg.id} className={`chat-msg ${msg.isSelf ? 'self' : 'other'}`}>
                                        <span className="chat-msg-sender">
                                            {msg.isSelf ? `${msg.sender} (YOU)` : msg.sender}
                                        </span>
                                        <div className="chat-msg-bubble">
                                            {msg.text}
                                        </div>
                                    </div>
                                )
                            )
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    <div className="chat-input-area">
                        {showEmoji && (
                            <div className="emoji-picker">
                                {EMOJI_LIST.map((emoji, i) => (
                                    <button key={i} className="emoji-btn" onClick={() => handleEmojiClick(emoji)}>
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="emoji-row">
                            <button
                                className={`emoji-toggle-btn ${showEmoji ? 'active' : ''}`}
                                onClick={() => setShowEmoji(prev => !prev)}
                            >
                                {showEmoji ? '[-]' : '[+]'}
                            </button>
                        </div>

                        <div className="chat-input-row">
                            <input
                                type="text"
                                className="chat-input"
                                placeholder={lobby ? "Waiting for connection..." : "Type a message..."}
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') sendMessage();
                                }}
                                disabled={lobby}
                            />
                            <button
                                className="chat-send-btn"
                                onClick={sendMessage}
                                disabled={lobby || !chatInput.trim()}
                            >
                                SEND
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
