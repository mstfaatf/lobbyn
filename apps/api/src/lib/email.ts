import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  throw new Error('Missing required environment variable: RESEND_API_KEY');
}
if (!process.env.RESEND_FROM_EMAIL) {
  throw new Error('Missing required environment variable: RESEND_FROM_EMAIL');
}

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail({
  to,
  displayName,
  verifyUrl,
}: {
  to: string;
  displayName: string;
  verifyUrl: string;
}): Promise<void> {
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL as string,
    to,
    subject: 'Verify your Lobbyn email',
    text: `Hi ${displayName}, verify your email by clicking: ${verifyUrl}. This link expires in 24 hours.`,
  });

  if (error) {
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}
