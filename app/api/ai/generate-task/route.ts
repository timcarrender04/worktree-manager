import { NextResponse } from 'next/server';
import { generateTaskFromVoice } from '@/lib/ai/task-generator';

interface GenerateTaskRequest {
  transcript: string;
  branchType: 'feat' | 'bugs' | 'fixes' | 'qaqc';
}

export async function POST(request: Request) {
  try {
    const body: GenerateTaskRequest = await request.json();
    const { transcript, branchType } = body;

    if (!transcript || !branchType) {
      return NextResponse.json(
        { error: 'Missing required fields: transcript, branchType' },
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

    // Use Ollama task generator
    try {
      const task = await generateTaskFromVoice(
        transcript.trim(),
        branchType as 'feat' | 'bugs' | 'fixes' | 'qaqc'
      );

      return NextResponse.json(task);
    } catch (error: any) {
      console.error('Error generating task with Ollama:', error);
      
      // Fallback: Simple rule-based generation
      return NextResponse.json({
        title: generateTitleFallback(transcript, branchType),
        branchName: generateBranchNameFallback(transcript, branchType),
        description: transcript,
      });
    }
  } catch (error: any) {
    console.error('Error in generate-task:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate task' },
      { status: 500 }
    );
  }
}

function generateTitleFallback(transcript: string, branchType: string): string {
  // Extract key words from transcript
  const words = transcript.split(/\s+/).filter(w => w.length > 3);
  const keyWords = words.slice(0, 5).join(' ');
  
  // Capitalize first letter
  return keyWords.charAt(0).toUpperCase() + keyWords.slice(1).substring(0, 60);
}

function generateBranchNameFallback(transcript: string, branchType: string): string {
  // Extract key words and convert to kebab-case
  const words = transcript
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(w))
    .slice(0, 4)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 0);
  
  const description = words.join('-').substring(0, 30);
  return `${branchType}-${description}`;
}
