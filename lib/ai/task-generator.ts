import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import { query } from '@/lib/db/client';

const TaskOutputSchema = z.object({
  title: z.string().describe('Short, descriptive task title (max 100 characters)'),
  branchName: z.string().describe('Short branch name in kebab-case (max 30 characters total including prefix, no spaces, lowercase)'),
  description: z.string().describe('Full task description for kanban board body'),
});

export type TaskOutput = z.infer<typeof TaskOutputSchema>;

const parser = StructuredOutputParser.fromZodSchema(TaskOutputSchema);

export async function generateTaskFromVoice(
  voiceTranscript: string,
  branchType: 'feat' | 'bugs' | 'fixes' | 'qaqc'
): Promise<TaskOutput> {
  // Support both OLLAMA_SERVER and OLLAMA_BASE_URL for compatibility
  const ollamaServer = process.env.OLLAMA_SERVER || process.env.OLLAMA_BASE_URL || '192.168.1.223:11434';
  // Add http:// if not present
  const ollamaBaseUrl = ollamaServer.startsWith('http') ? ollamaServer : `http://${ollamaServer}`;
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';

  const model = new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model: ollamaModel,
    temperature: 0.7,
  });

  const branchTypeDescriptions = {
    feat: 'new feature',
    bugs: 'bug fix',
    fixes: 'fix',
    qaqc: 'QA/QC (Quality Assurance/Quality Control)',
  };

  const prompt = ChatPromptTemplate.fromTemplate(`You are a project manager creating a task from a developer's voice description.

Your job is to:
1. Create a clear, concise task title (max 100 characters)
2. Generate a SHORT branch name in kebab-case format (MAX 30 characters total, including prefix)
3. Write a detailed task description for the kanban board

CRITICAL: The branch name MUST be SHORT and TO THE POINT:
- Start with the branch type prefix: ${branchType}-
- Maximum 30 characters TOTAL (including the "${branchType}-" prefix)
- Use ONLY the essential keywords (2-4 words max)
- Remove articles, prepositions, and filler words
- Be specific but brief
- Use kebab-case (lowercase with hyphens)
- No special characters except hyphens

Examples of GOOD short branch names:
- "feat-oauth-login" (not "feat-implement-google-oauth-login")
- "fix-auth-error" (not "fix-authentication-error-handling")
- "bugs-memory-leak" (not "bugs-fix-memory-leak-in-component")
- "qaqc-test-coverage" (not "qaqc-improve-test-coverage")

The task description should be professional and include:
- What needs to be done
- Why it's needed (if clear from context)
- Any relevant details

Voice transcript: {transcript}
Branch type: ${branchTypeDescriptions[branchType]} (${branchType})

Generate the task title, SHORT branch name, and description. Return ONLY valid JSON in this format:
{{
  "title": "Task title here",
  "branchName": "${branchType}-short-name",
  "description": "Full task description here"
}}`);

  const chain = prompt.pipe(model as any).pipe(parser);

  try {
    const result = await chain.invoke({
      transcript: voiceTranscript,
    });

    // Validate and sanitize the branch name - keep it SHORT
    let sanitizedBranchName = result.branchName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Ensure it starts with the branch type prefix
    if (!sanitizedBranchName.startsWith(`${branchType}-`)) {
      sanitizedBranchName = `${branchType}-${sanitizedBranchName}`;
    }

    // Enforce maximum length of 30 characters (including prefix)
    // If too long, truncate intelligently by removing words from the middle/end
    if (sanitizedBranchName.length > 30) {
      const prefix = `${branchType}-`;
      const namePart = sanitizedBranchName.substring(prefix.length);
      
      // Split into words and keep only the most important ones
      const words = namePart.split('-').filter(w => w.length > 0);
      
      // Keep only first 2-3 words if it's still too long
      let truncated = words.slice(0, 3).join('-');
      if ((prefix + truncated).length > 30) {
        truncated = words.slice(0, 2).join('-');
      }
      if ((prefix + truncated).length > 30) {
        truncated = words[0] || 'task';
      }
      
      sanitizedBranchName = prefix + truncated;
      
      // Final safety: hard limit at 30 characters
      sanitizedBranchName = sanitizedBranchName.substring(0, 30);
    }

    return {
      ...result,
      branchName: sanitizedBranchName,
    };
  } catch (error) {
    console.error('Error generating task:', error);
    throw new Error(`Failed to generate task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

interface BranchNameContext {
  recentBranchNames: string[];
  recentTitles: string[];
  repositoryNames: string[];
}

export async function generateBranchNameFromContext(
  branchType: 'feat' | 'bugs' | 'fixes' | 'qaqc',
  repositories: string[] = []
): Promise<string> {
  // Support both OLLAMA_SERVER and OLLAMA_BASE_URL for compatibility
  const ollamaServer = process.env.OLLAMA_SERVER || process.env.OLLAMA_BASE_URL || '192.168.1.223:11434';
  // Add http:// if not present
  const ollamaBaseUrl = ollamaServer.startsWith('http') ? ollamaServer : `http://${ollamaServer}`;
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';

  const model = new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model: ollamaModel,
    temperature: 0.7,
  });

  // Fetch context from NeonDB
  let context: BranchNameContext = {
    recentBranchNames: [],
    recentTitles: [],
    repositoryNames: repositories,
  };

  try {
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;
    
    if (isUsingNeon) {
      // Query recent feature branches and titles from kanban_items
      const contextResult = await query(`
        SELECT branch_name, title 
        FROM kanban_items 
        WHERE branch_type = $1 
        ORDER BY created_at DESC 
        LIMIT 20
      `, [branchType]);

      if (contextResult && contextResult.rows.length > 0) {
        context.recentBranchNames = contextResult.rows
          .map((row: any) => row.branch_name)
          .filter((name: string | null) => name && name.startsWith(`${branchType}-`))
          .slice(0, 15);
        
        context.recentTitles = contextResult.rows
          .map((row: any) => row.title)
          .filter((title: string | null) => title)
          .slice(0, 10);
      }
    }
  } catch (error) {
    console.error('Error fetching context from database:', error);
    // Continue with empty context if database query fails
  }

  const branchTypeDescriptions = {
    feat: 'new feature',
    bugs: 'bug fix',
    fixes: 'fix',
    qaqc: 'QA/QC (Quality Assurance/Quality Control)',
  };

  // Build context strings for prompt
  const recentBranchesStr = context.recentBranchNames.length > 0
    ? `\n\nRecent ${branchTypeDescriptions[branchType]} branch names for reference:\n${context.recentBranchNames.slice(0, 10).map((name, i) => `${i + 1}. ${name}`).join('\n')}`
    : '';

  const recentTitlesStr = context.recentTitles.length > 0
    ? `\n\nRecent ${branchTypeDescriptions[branchType]} task titles for context:\n${context.recentTitles.slice(0, 5).map((title, i) => `${i + 1}. ${title}`).join('\n')}`
    : '';

  const reposStr = context.repositoryNames.length > 0
    ? `\n\nRepositories: ${context.repositoryNames.join(', ')}`
    : '';

  const prompt = ChatPromptTemplate.fromTemplate(`You are a developer creating a new ${branchTypeDescriptions[branchType]} branch. Generate a SHORT, descriptive branch name.

CRITICAL REQUIREMENTS:
- Start with the branch type prefix: ${branchType}-
- Maximum 30 characters TOTAL (including the "${branchType}-" prefix)
- Use ONLY the essential keywords (2-4 words max)
- Remove articles, prepositions, and filler words
- Be specific but brief
- Use kebab-case (lowercase with hyphens)
- No special characters except hyphens
- Make it unique and descriptive${recentBranchesStr}

Examples of GOOD short branch names:
- "feat-oauth-login" (not "feat-implement-google-oauth-login")
- "fix-auth-error" (not "fix-authentication-error-handling")
- "bugs-memory-leak" (not "bugs-fix-memory-leak-in-component")
- "qaqc-test-coverage" (not "qaqc-improve-test-coverage")${recentTitlesStr}${reposStr}

Generate a new ${branchTypeDescriptions[branchType]} branch name that follows these patterns. Return ONLY the branch name (e.g., "${branchType}-example-name"), nothing else.`);

  try {
    const chain = prompt.pipe(model as any);
    const result = await chain.invoke({});

    // Extract branch name from response (handles both string and object responses)
    let generatedName = '';
    if (typeof result === 'string') {
      generatedName = result.trim();
    } else if (result && typeof result.content === 'string') {
      generatedName = result.content.trim();
    } else {
      generatedName = String(result).trim();
    }

    // Remove any markdown formatting or quotes
    generatedName = generatedName.replace(/^["'`]|["'`]$/g, '').replace(/^`+[a-z]*|`+$/g, '').trim();

    // Validate and sanitize the branch name - keep it SHORT
    let sanitizedBranchName = generatedName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Ensure it starts with the branch type prefix
    if (!sanitizedBranchName.startsWith(`${branchType}-`)) {
      sanitizedBranchName = `${branchType}-${sanitizedBranchName}`;
    }

    // Enforce maximum length of 30 characters (including prefix)
    // If too long, truncate intelligently by removing words from the middle/end
    if (sanitizedBranchName.length > 30) {
      const prefix = `${branchType}-`;
      const namePart = sanitizedBranchName.substring(prefix.length);
      
      // Split into words and keep only the most important ones
      const words = namePart.split('-').filter(w => w.length > 0);
      
      // Keep only first 2-3 words if it's still too long
      let truncated = words.slice(0, 3).join('-');
      if ((prefix + truncated).length > 30) {
        truncated = words.slice(0, 2).join('-');
      }
      if ((prefix + truncated).length > 30) {
        truncated = words[0] || 'task';
      }
      
      sanitizedBranchName = prefix + truncated;
      
      // Final safety: hard limit at 30 characters
      sanitizedBranchName = sanitizedBranchName.substring(0, 30);
    }

    // Ensure it's not empty
    if (!sanitizedBranchName || sanitizedBranchName === `${branchType}-`) {
      // Fallback: generate a simple name
      sanitizedBranchName = `${branchType}-${Date.now().toString().slice(-6)}`;
    }

    return sanitizedBranchName;
  } catch (error) {
    console.error('Error generating branch name:', error);
    // Fallback: generate a simple timestamp-based name
    return `${branchType}-${Date.now().toString().slice(-6)}`;
  }
}
