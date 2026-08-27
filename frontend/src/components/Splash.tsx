import { useNavigate } from "react-router-dom";
import { PixelBackground } from "./PixelBackground";
import "./Splash.css";

export const Splash = () => {
    const navigate = useNavigate();

    return (
        <>
            <PixelBackground />
            <div className="crt-overlay" />
            <div className="splash-wrapper">
                <div className="splash-logo">
                    <span className="logo-m">M</span>
                    <span className="logo-i">I</span>
                    <span className="logo-n">N</span>
                    <span className="logo-i2">I</span>
                </div>
                <p className="splash-tagline">COLLEGE EXCLUSIVE VIDEO CHAT</p>

                <div className="splash-actions">
                    <button className="pixel-btn green" onClick={() => navigate("/login")}>
                        START GAME
                    </button>
                    <button className="pixel-btn cyan" onClick={() => navigate("/about")}>
                        ABOUT
                    </button>
                </div>

                <div className="splash-version">v2.0 — PRESS START</div>
            </div>
        </>
    );
};
