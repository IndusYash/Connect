import nodemailer from "nodemailer";

export async function sendResetEmail(email: string, token: string) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.EMAIL_FROM || "MINI <onboarding@resend.dev>";

    // If no credentials are provided, fall back to console mock
    if (!host || !user || !pass) {
        console.log("=========================================");
        console.log(`[MOCK EMAIL SERVICE]`);
        console.log(`To: ${email}`);
        console.log(`Subject: Reset your MINI Password`);
        console.log(`Link: ${resetLink}`);
        console.log("=========================================");
        return;
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // true for 465, false for other ports
        auth: {
            user,
            pass,
        },
    });

    await transporter.sendMail({
        from,
        to: email,
        subject: "Reset your MINI Password",
        html: `
            <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: auto; border: 1px solid #ccc; border-radius: 5px;">
                <h2 style="color: #ff007f; text-shadow: 0 0 4px rgba(255,0,127,0.1)">MINI Password Reset</h2>
                <p>You requested a password reset. Click the button below to choose a new password. This link is valid for 1 hour.</p>
                <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #ff007f; color: white; text-decoration: none; border-radius: 3px; font-weight: bold; margin: 20px 0;">Reset Password</a>
                <p>If the button doesn't work, copy and paste this link in your browser:</p>
                <p style="word-break: break-all; color: #ff007f;">${resetLink}</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin-top: 30px;" />
                <p style="font-size: 0.8rem; color: #888;">If you did not request this email, you can safely ignore it.</p>
            </div>
        `,
    });
}
