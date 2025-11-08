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

function sanitizeTaskOutput(
  result: TaskOutput,
  branchType: 'feat' | 'bugs' | 'fixes' | 'qaqc'
): TaskOutput {
  let sanitizedBranchName = result.branchName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!sanitizedBranchName.startsWith(`${branchType}-`)) {
    sanitizedBranchName = `${branchType}-${sanitizedBranchName}`;
  }

  if (sanitizedBranchName.length > 30) {
    const prefix = `${branchType}-`;
    const namePart = sanitizedBranchName.substring(prefix.length);
    const words = namePart.split('-').filter((w) => w.length > 0);

    let truncated = words.slice(0, 3).join('-');
    if ((prefix + truncated).length > 30) {
      truncated = words.slice(0, 2).join('-');
    }
    if ((prefix + truncated).length > 30) {
      truncated = words[0] || 'task';
    }

    sanitizedBranchName = prefix + truncated;
    sanitizedBranchName = sanitizedBranchName.substring(0, 30);
  }

  return {
    ...result,
    branchName: sanitizedBranchName,
  };
}

export async function generateTaskFromVoice(
  voiceTranscript: string,
  branchType: 'feat' | 'bugs' | 'fixes' | 'qaqc'
): Promise<TaskOutput> {
  // Support both OLLAMA_SERVER and OLLAMA_BASE_URL for compatibility
  const ollamaServer = process.env.OLLAMA_SERVER || process.env.OLLAMA_BASE_URL || 'https://ollama.timcarrender.me';
  // Add http:// if not present
  const ollamaBaseUrl = ollamaServer.startsWith('http') ? ollamaServer : `http://${ollamaServer}`;
  const ollamaModel = process.env.OLLAMA_MODEL || 'mistral';

  const model = new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model: ollamaModel,
    temperature: 0.7,
    // Note: If generation is slow, check if Ollama is using GPU
    // Run: nvidia-smi on the Ollama server to verify GPU usage
  });

  const branchTypeDescriptions = {
    feat: 'new feature',
    bugs: 'bug fix',
    fixes: 'fix',
    qaqc: 'QA/QC (Quality Assurance/Quality Control)',
  };

  const branchTypePrefix = `${branchType}-`;
  const branchTypeLabel = `${branchTypeDescriptions[branchType]} (${branchType})`;

  const prompt = ChatPromptTemplate.fromTemplate(`You are a project manager creating a task from a developer's voice description.

## Task Requirements

**Task Title:**
- Clear, actionable title (max 100 characters)
- Start with a verb when possible (e.g., "Implement", "Fix", "Add")

**Branch Name:**
- Format: ${branchTypePrefix}[2-4-keywords]
- MAX 30 characters total (including "${branchTypePrefix}" prefix)
- Use ONLY essential keywords - remove articles, prepositions, and filler words
- Kebab-case only (lowercase with hyphens)
- Be specific but concise

**Task Description:**
- What needs to be done (clear action items)
- Why it's needed (if mentioned in transcript)
- Any technical details or constraints
- Acceptance criteria (if applicable)

## Branch Name Examples

✅ GOOD (concise, clear):
- ${branchTypePrefix}oauth-login (not "implement-google-oauth-login-feature")
- ${branchTypePrefix}auth-error (not "fix-authentication-error-handling-issue")
- ${branchTypePrefix}api-timeout (not "increase-api-timeout-value")
- ${branchTypePrefix}user-avatar (not "add-user-avatar-upload-feature")

❌ AVOID (too long, unnecessary words):
- ${branchTypePrefix}implement-new-feature
- ${branchTypePrefix}fix-the-bug-in-component
- ${branchTypePrefix}update-and-refactor-code

## Input Context

Voice transcript: {transcript}
Branch type: ${branchTypeLabel}

## Output Format

Return ONLY valid JSON (no markdown, no extra text):

{{
  "title": "Action-oriented task title",
  "branchName": "${branchTypePrefix}short-descriptive-name",
  "description": "Detailed description with context, requirements, and any relevant technical details or acceptance criteria."
}}`);

  const chain = prompt.pipe(model as any).pipe(parser);

  try {
    console.log(`[AI] Starting task generation with model: ${ollamaModel} at ${ollamaBaseUrl}`);
    const startTime = Date.now();
    
    // Add timeout wrapper (120 seconds for 7B model - allows slower CPU generations)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('AI generation timeout after 120 seconds')), 120000);
    });
    
    const result = await Promise.race([
      chain.invoke({
        transcript: voiceTranscript,
      }),
      timeoutPromise,
    ]);
    
    const duration = Date.now() - startTime;
    console.log(`[AI] Task generation completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    
    if (duration > 10000) {
      console.warn(`[AI] WARNING: Generation took ${(duration / 1000).toFixed(2)}s. This suggests the model may not be using GPU. Check Ollama server GPU configuration.`);
    }

    return sanitizeTaskOutput(result as TaskOutput, branchType);
  } catch (error) {
    console.error('Error generating task with Ollama:', error);
    
    // Check if it's a model not found error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const llmOutput =
      typeof error === 'object' && error !== null && 'llmOutput' in error
        ? (error as any).llmOutput
        : undefined;

    if (llmOutput) {
      const jsonMatch = String(llmOutput).match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = TaskOutputSchema.parse(JSON.parse(jsonMatch[0]));
          console.warn('[AI] Parsed task output from non-JSON response.');
          return sanitizeTaskOutput(parsed, branchType);
        } catch (parseError) {
          console.warn('[AI] Failed to salvage task output from llmOutput:', parseError);
        }
      }
    }
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      console.warn(`Ollama model "${ollamaModel}" not found. Available models: mistral, llama2, codellama, medllama2. Using fallback generation.`);
      // Don't throw - let the caller handle fallback
      throw new Error(`Model "${ollamaModel}" not found on Ollama server. Please check available models or set OLLAMA_MODEL environment variable.`);
    }
    
    // For other errors, provide more context
    throw new Error(`Failed to generate task: ${errorMessage}. Check Ollama server at ${ollamaBaseUrl} is running and accessible.`);
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
  const ollamaServer = process.env.OLLAMA_SERVER || process.env.OLLAMA_BASE_URL || 'https://ollama.timcarrender.me';
  // Add http:// if not present
  const ollamaBaseUrl = ollamaServer.startsWith('http') ? ollamaServer : `http://${ollamaServer}`;
  const ollamaModel = process.env.OLLAMA_MODEL || 'mistral';

  const model = new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model: ollamaModel,
    temperature: 0.7,
    // Note: If generation is slow, check if Ollama is using GPU
    // Run: nvidia-smi on the Ollama server to verify GPU usage
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
    console.log(`[AI] Starting branch name generation with model: ${ollamaModel} at ${ollamaBaseUrl}`);
    const startTime = Date.now();
    
    // Add timeout wrapper (30 seconds for branch name generation)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('AI generation timeout after 30 seconds')), 30000);
    });
    
    const chain = prompt.pipe(model as any);
    const result = await Promise.race([
      chain.invoke({}),
      timeoutPromise,
    ]);
    
    const duration = Date.now() - startTime;
    console.log(`[AI] Branch name generation completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    
    if (duration > 5000) {
      console.warn(`[AI] WARNING: Generation took ${(duration / 1000).toFixed(2)}s. This suggests the model may not be using GPU. Check Ollama server GPU configuration.`);
    }

    // Extract branch name from response (handles both string and object responses)
    let generatedName = '';
    if (typeof result === 'string') {
      generatedName = result.trim();
    } else if (result && typeof result === 'object' && 'content' in result && typeof result.content === 'string') {
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
    console.error('Error generating branch name with Ollama:', error);
    
    // Check if it's a model not found error
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      console.warn(`Ollama model "${ollamaModel}" not found. Using fallback branch name generation.`);
    }
    
    // Fallback: generate a simple timestamp-based name
    return `${branchType}-${Date.now().toString().slice(-6)}`;
  }
}
