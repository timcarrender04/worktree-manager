import nodemailer from 'nodemailer'

// Brevo SMTP configuration
// Brevo uses smtp-relay.brevo.com with API key authentication
function createTransporter() {
  if (!process.env.BREVO_SMTP_KEY) {
    throw new Error('BREVO_SMTP_KEY environment variable is required')
  }

  return nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.BREVO_SMTP_USER || process.env.BREVO_API_KEY || '',
      pass: process.env.BREVO_SMTP_KEY,
    },
  })
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  console.log('📧 sendEmail called with options:', {
    to: options.to,
    subject: options.subject,
    hasHtml: !!options.html,
    hasText: !!options.text,
    from: options.from,
  })

  // Check environment variables - prefer API key over SMTP
  const hasBrevoApiKey = !!process.env.BREVO_API_KEY
  const hasBrevoSmtpKey = !!process.env.BREVO_SMTP_KEY
  const brevoUser = process.env.BREVO_SMTP_USER
  const brevoFrom = process.env.BREVO_FROM_EMAIL

  console.log('🔧 Brevo configuration:', {
    hasBrevoApiKey,
    hasBrevoSmtpKey,
    hasBrevoUser: !!brevoUser,
    brevoUser: brevoUser ? `${brevoUser.substring(0, 10)}...` : 'not set',
    brevoFrom,
    brevoFromName: process.env.BREVO_FROM_NAME,
  })

  // Try API first (more reliable), fallback to SMTP
  if (hasBrevoApiKey) {
    console.log('🚀 Using Brevo API for email sending')
    return await sendEmailViaAPI(options)
  }

  if (!hasBrevoSmtpKey) {
    const error = 'BREVO_API_KEY or BREVO_SMTP_KEY environment variable is required'
    console.error('❌', error)
    throw new Error(error)
  }

  console.log('📮 Using Brevo SMTP for email sending')
  const transporter = createTransporter()
  const fromEmail = options.from || brevoFrom || 'noreply@worktree-manager.com'
  const fromName = process.env.BREVO_FROM_NAME || 'Worktree Manager'

  console.log('📤 Sending email via Brevo SMTP:', {
    from: `"${fromName}" <${fromEmail}>`,
    to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
    subject: options.subject,
  })

  try {
    const result = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    })

    console.log('✅ Email sent successfully via Brevo SMTP:', {
      messageId: result.messageId,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected,
    })

    if (result.rejected && result.rejected.length > 0) {
      console.warn('⚠️ Some recipients were rejected:', result.rejected)
    }
  } catch (error) {
    console.error('❌ Error sending email via Brevo SMTP:', error)
    console.error('Error details:', {
      message: error instanceof Error ? error.message : String(error),
      code: (error as any)?.code,
      command: (error as any)?.command,
      response: (error as any)?.response,
      responseCode: (error as any)?.responseCode,
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw new Error('Failed to send email')
  }
}

// Use Brevo API directly (more reliable, better tracking)
async function sendEmailViaAPI(options: SendEmailOptions): Promise<void> {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY environment variable is required')
  }

  const apiKey = process.env.BREVO_API_KEY
  const fromEmail = options.from || process.env.BREVO_FROM_EMAIL || 'noreply@worktree-manager.com'
  const fromName = process.env.BREVO_FROM_NAME || 'Worktree Manager'

  const recipients = Array.isArray(options.to) 
    ? options.to.map(email => ({ email }))
    : [{ email: options.to }]

  console.log('🚀 Sending email via Brevo API:', {
    from: `"${fromName}" <${fromEmail}>`,
    to: recipients.map(r => r.email).join(', '),
    subject: options.subject,
  })

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: fromName,
          email: fromEmail,
        },
        to: recipients,
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
      }),
    })

    const responseData = await response.json().catch(() => ({}))

    if (!response.ok) {
      console.error('❌ Brevo API error response:', {
        status: response.status,
        statusText: response.statusText,
        data: responseData,
      })
      throw new Error(`Brevo API error: ${responseData.message || response.statusText || 'Unknown error'}`)
    }

    console.log('✅ Email sent successfully via Brevo API:', {
      messageId: responseData.messageId,
      status: response.status,
      data: responseData,
    })

    return
  } catch (error) {
    console.error('❌ Error sending email via Brevo API:', error)
    throw error
  }
}

