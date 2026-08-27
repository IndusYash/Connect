import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiForgotPassword } from "../api";
import "./Auth.css";

export const ForgotPassword = () => {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setLoading(true);
        setError("");
        setMessage("");
        try {
            const data = await apiForgotPassword(email);
            setMessage(data.message || "If a matching email exists, a reset link has been sent.");
        } catch (err: any) {
            setError(err.message || "Failed to process request");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="crt-overlay" />
            <div className="auth-wrapper">
                <div className="auth-card">
                    <h1 className="auth-title">
                        <span className="title-friend">MINI</span>
                    </h1>
                    <p className="auth-subtitle">FORGOT PASSWORD</p>

                    {message ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            <div style={{ fontFamily: "var(--font-pixel)", fontSize: "0.35rem", color: "var(--neon-green)", border: "2px solid var(--neon-green)", padding: "12px", letterSpacing: "1px" }}>
                                {message}
                            </div>
                            <button className="pixel-btn green" style={{ width: "100%" }} onClick={() => navigate("/login")}>
                                BACK TO LOGIN
                            </button>
                        </div>
                    ) : (
                        <form className="auth-form" onSubmit={handleSubmit}>
                            <div className="auth-field">
                                <label className="auth-label">{'>'} COLLEGE EMAIL</label>
                                <input
                                    type="email"
                                    className="auth-input"
                                    placeholder="you@college.ac.in"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                    disabled={loading}
                                />
                            </div>

                            {error && <div className="auth-error">{error}</div>}

                            <button type="submit" className="pixel-btn green" disabled={loading} style={{ width: "100%" }}>
                                {loading ? "SENDING..." : "SEND RESET LINK"}
                            </button>

                            <div style={{ textAlign: "center", marginTop: "8px" }}>
                                <Link to="/login" className="forgot-link">← BACK TO LOGIN</Link>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </>
    );
};
