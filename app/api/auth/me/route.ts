import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('wt_session')

    if (!sessionToken) {
      return NextResponse.json({ user: null })
    }

    try {
      // Decode the session token
      const sessionData = JSON.parse(Buffer.from(sessionToken.value, 'base64').toString())

      // Check if token is expired
      if (sessionData.exp && Date.now() > sessionData.exp) {
        return NextResponse.json({ user: null })
      }

      return NextResponse.json({
        user: {
          id: sessionData.userId,
          email: sessionData.email,
        },
      })
    } catch (error) {
      // Invalid token
      return NextResponse.json({ user: null })
    }
  } catch (error) {
    return NextResponse.json({ user: null })
  }
}
