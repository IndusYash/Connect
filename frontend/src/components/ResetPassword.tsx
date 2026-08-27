import React, { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { apiResetPassword } from "../api";
import "./Auth.css";

export const ResetPassword = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");
    const navigate = useNavigate();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) { setError("No reset token found in the URL."); return; }
        if (password !== confirmPassword) { setError("Passwords do not match."); return; }
        setLoading(true);
        setError("");
        try {
            const data = await apiResetPassword(token, password);
            setMessage(data.message || "Password reset successfully.");
        } catch (err: any) {
            setError(err.message || "Reset failed. The link may have expired.");
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
                    <p className="auth-subtitle">RESET PASSWORD</p>

                    {message ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            <div style={{ fontFamily: "var(--font-pixel)", fontSize: "0.35rem", color: "var(--neon-green)", border: "2px solid var(--neon-green)", padding: "12px", letterSpacing: "1px" }}>
                                {message}
                            </div>
                            <button className="pixel-btn green" style={{ width: "100%" }} onClick={() => navigate("/login")}>
                                LOG IN NOW
                            </button>
                        </div>
                    ) : !token ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            <div className="auth-error">INVALID OR MISSING RESET TOKEN.</div>
                            <button className="pixel-btn red" style={{ width: "100%" }} onClick={() => navigate("/login")}>
                                BACK TO LOGIN
                            </button>
                        </div>
                    ) : (
                        <form className="auth-form" onSubmit={handleSubmit}>
                            <div className="auth-field">
                                <label className="auth-label">{'>'} NEW PASSWORD</label>
                                <input type="password" className="auth-input" placeholder="Min 6 characters" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required disabled={loading} />
                            </div>
                            <div className="auth-field">
                                <label className="auth-label">{'>'} CONFIRM PASSWORD</label>
                                <input type="password" className="auth-input" placeholder="Re-enter password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={6} required disabled={loading} />
                            </div>

                            {error && <div className="auth-error">{error}</div>}

                            <button type="submit" className="pixel-btn green" disabled={loading} style={{ width: "100%" }}>
                                {loading ? "RESETTING..." : "RESET PASSWORD"}
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
