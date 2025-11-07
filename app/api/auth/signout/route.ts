import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const cookieStore = await cookies()
    
    // Clear the session cookie
    cookieStore.delete('wt_session')
    
    return NextResponse.json({ success: true, message: 'Signed out successfully' })
  } catch (error: any) {
    console.error('Error signing out:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to sign out' },
      { status: 500 }
    )
  }
}


