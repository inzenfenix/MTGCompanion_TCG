export function renderWelcomeEmail(displayName: string): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Welcome to MTG Companion';
  const text = `Hi ${displayName},\n\nYour MTG Companion account is ready. Scan a card to get started.\n\n— MTG Companion`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="color:#7a1f2b;">Welcome, ${displayName}!</h1>
      <p>Your MTG Companion account is ready. Scan a card to identify it, check its estimated value, and start building your collection.</p>
      <p style="color:#888; font-size: 12px;">— MTG Companion</p>
    </div>
  `.trim();
  return { subject, html, text };
}
