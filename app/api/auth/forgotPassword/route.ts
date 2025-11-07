import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/client'
import { randomBytes } from 'crypto'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email } = body

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Find user by email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .maybeSingle()

    // Don't reveal if email exists (security)
    if (userError || !user) {
      // Return success even if user doesn't exist (security best practice)
      return NextResponse.json({
        message: 'If an account with that email exists, a password reset link has been sent.',
      })
    }

    // Generate reset token
    const token = randomBytes(32).toString('hex')
    const expires = new Date()
    expires.setHours(expires.getHours() + 24) // 24 hour expiry

    // Store token in password_reset_tokens table
    const { error: tokenError } = await supabase
      .from('password_reset_tokens')
      .insert({
        user_id: user.id,
        email: user.email,
        token,
        expires_at: expires.toISOString(),
      })

    if (tokenError) {
      console.error('Error storing password reset token:', tokenError)
      return NextResponse.json(
        { error: 'Failed to generate reset token' },
        { status: 500 }
      )
    }

    // Generate reset URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3333'
    const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`

    // Send email
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
        <div style="background-color: #ffffff; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); border-top: 4px solid #3b82f6;">
          <h1 style="color: #1e3a8a; margin-top: 0; font-size: 28px; font-weight: 700;">Reset Your Password</h1>
          <p style="font-size: 16px; color: #1e40af; margin: 16px 0;">
            You requested to reset your password for Worktree Manager.
          </p>
          <p style="font-size: 16px; color: #1e40af; margin: 16px 0;">
            Click the button below to reset your password. This link will expire in 24 hours.
          </p>
          <div style="margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
              Reset Password
            </a>
          </div>
          <p style="font-size: 14px; color: #64748b; margin-top: 32px;">
            If you didn't request this password reset, you can safely ignore this email.
          </p>
          <p style="font-size: 14px; color: #64748b;">
            Or copy and paste this link into your browser:<br>
            <a href="${resetUrl}" style="color: #3b82f6; word-break: break-all;">${resetUrl}</a>
          </p>
        </div>
      </body>
      </html>
    `

    const emailText = `
Reset Your Password

You requested to reset your password for Worktree Manager.

Click the link below to reset your password. This link will expire in 24 hours.

${resetUrl}

If you didn't request this password reset, you can safely ignore this email.
    `

    await sendEmail({
      to: user.email,
      subject: 'Reset Your Password - Worktree Manager',
      html: emailHtml,
      text: emailText,
    })

    console.log('Password reset email sent to:', user.email)

    return NextResponse.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
    })
  } catch (error: any) {
    console.error('Error in forgotPassword:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process password reset request' },
      { status: 500 }
    )
  }
}

