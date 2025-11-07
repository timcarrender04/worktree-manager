import { NextResponse } from 'next/server'
import { createGitHubClient } from '@/lib/github/client'
import { query } from '@/lib/db/client'
import { getAuthenticatedUserId } from '@/lib/credentials/helpers'

export async function GET() {
  try {
    let userId = await getAuthenticatedUserId()

    if (!userId) {
      if (process.env.NODE_ENV === 'development') {
        userId = 'dev'
      } else {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const accounts: any[] = []

    try {
      const result = await query(
        `SELECT id, account_name, github_username, created_at
         FROM github_accounts
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      )

      accounts.push(...(result.rows || []))
    } catch (error: any) {
      console.warn('Error fetching github_accounts:', error.message)
    }

    try {
      const tokensResult = await query(
        `SELECT id, name, value, created_at
         FROM tokens
         ORDER BY created_at DESC`
      )

      for (const token of tokensResult.rows || []) {
        const virtualAccountId = `token-${token.id}`

        const alreadyExists = accounts.some(
          (acc) => acc.id === virtualAccountId || acc.account_name === token.name
        )

        if (alreadyExists) {
          continue
        }

        try {
          const githubClient = createGitHubClient(token.value)
          const githubUser = await githubClient.getAuthenticatedUser()

          accounts.push({
            id: virtualAccountId,
            account_name: token.name,
            github_username: githubUser.login,
            created_at: token.created_at,
            from_tokens_table: true,
          })
        } catch (validationError: any) {
          console.warn(`Token "${token.name}" is invalid:`, validationError.message)
          accounts.push({
            id: virtualAccountId,
            account_name: `${token.name} (Invalid)` ,
            github_username: null,
            created_at: token.created_at,
            from_tokens_table: true,
            is_invalid: true,
          })
        }
      }
    } catch (tokenError: any) {
      console.warn('Error fetching tokens table (may not exist):', tokenError.message)
    }

    return NextResponse.json({ accounts })
  } catch (error: any) {
    console.error('Error in GET /api/github-accounts:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error', accounts: [] },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return NextResponse.json(
    {
      error: 'GitHub accounts are managed in Project Tim. Please add or update accounts from Project Tim settings.',
    },
    { status: 405 }
  )
}

export async function DELETE(request: Request) {
  return NextResponse.json(
    {
      error: 'GitHub accounts are managed in Project Tim. Please remove accounts from Project Tim settings.',
    },
    { status: 405 }
  )
}

