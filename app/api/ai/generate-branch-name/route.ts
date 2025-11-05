import { NextResponse } from 'next/server';
import { generateBranchNameFromContext } from '@/lib/ai/task-generator';

interface GenerateBranchNameRequest {
  branchType: 'feat' | 'bugs' | 'fixes' | 'qaqc';
  repositories?: string[];
}

export async function POST(request: Request) {
  try {
    const body: GenerateBranchNameRequest = await request.json();
    const { branchType, repositories = [] } = body;

    if (!branchType) {
      return NextResponse.json(
        { error: 'Missing required field: branchType' },
        { status: 400 }
      );
    }

    // Validate branch type
    if (!['feat', 'bugs', 'fixes', 'qaqc'].includes(branchType)) {
      return NextResponse.json(
        { error: 'Invalid branch type. Must be: feat, bugs, fixes, or qaqc' },
        { status: 400 }
      );
    }

    // Generate branch name using AI with context from database
    try {
      const branchName = await generateBranchNameFromContext(
        branchType,
        repositories
      );

      return NextResponse.json({ branchName });
    } catch (error: any) {
      console.error('Error generating branch name with AI:', error);
      
      // Fallback: generate a simple timestamp-based name
      const fallbackName = `${branchType}-${Date.now().toString().slice(-6)}`;
      return NextResponse.json({ 
        branchName: fallbackName,
        warning: 'Used fallback generation due to AI error'
      });
    }
  } catch (error: any) {
    console.error('Error in generate-branch-name:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate branch name' },
      { status: 500 }
    );
  }
}

