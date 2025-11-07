import { cookies } from 'next/headers'

export interface SessionUser {
  id: string
  email: string
}

/**
 * Decode the custom `wt_session` cookie that is issued during login.
 * Returns the authenticated user or null when the cookie is missing/invalid/expired.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('wt_session')

    if (!sessionCookie?.value) {
      return null
    }

    try {
      const decoded = JSON.parse(Buffer.from(sessionCookie.value, 'base64').toString())

      if (decoded?.exp && Date.now() > decoded.exp) {
        return null
      }

      if (!decoded?.userId || typeof decoded.userId !== 'string') {
        return null
      }

      return {
        id: decoded.userId,
        email: typeof decoded.email === 'string' ? decoded.email : '',
      }
    } catch (decodeError) {
      console.warn('Failed to decode wt_session cookie', decodeError)
      return null
    }
  } catch (error) {
    console.error('Error accessing cookies when decoding wt_session', error)
    return null
  }
}

