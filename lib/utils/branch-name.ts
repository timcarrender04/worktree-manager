/**
 * Generate a branch name from a task title
 * Converts title to kebab-case and adds branch type prefix
 */
export function generateBranchNameFromTitle(
  title: string,
  branchType: 'feat' | 'bugs' | 'fixes' | 'qaqc'
): string {
  // Convert title to kebab-case
  let branchName = title
    .toLowerCase()
    // Remove special characters except spaces and hyphens
    .replace(/[^a-z0-9\s-]/g, '')
    // Replace spaces and multiple hyphens with single hyphen
    .replace(/[\s-]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Remove common words that don't add value
    .split('-')
    .filter(word => word.length > 0 && !['the', 'a', 'an', 'and', 'or', 'for', 'with', 'from', 'to', 'of', 'in', 'on', 'at'].includes(word))
    .join('-')
    // Limit to reasonable length (keep first 20 chars after prefix)
    .substring(0, 20);

  // Ensure it's not empty
  if (!branchName) {
    branchName = 'task';
  }

  // Add branch type prefix
  const fullBranchName = `${branchType}-${branchName}`;

  // Ensure total length doesn't exceed 40 characters
  if (fullBranchName.length > 40) {
    const prefix = `${branchType}-`;
    const namePart = branchName.substring(0, 40 - prefix.length);
    return `${prefix}${namePart}`;
  }

  return fullBranchName;
}

