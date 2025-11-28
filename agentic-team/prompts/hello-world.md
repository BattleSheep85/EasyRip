# Hello-World Validation Prompt v1.0

## Purpose
This is a minimal validation prompt to verify the agentic team pipeline is working end-to-end.

## Task
Generate a simple utility function for the EasyRip project.

## Context
EasyRip is a disc ripping application. Create a helper function that validates disc drive paths.

## Requirements
1. Create a function `isValidDrivePath(path: string): boolean`
2. Should validate Windows drive letter format (e.g., "E:", "F:")
3. Should be case-insensitive
4. Should return false for empty or invalid formats

## Constraints
- Pure TypeScript/JavaScript
- No external dependencies
- Must include JSDoc comments
- Must be testable

## Expected Output Format

```typescript
/**
 * Validates if a path is a valid Windows drive letter
 * @param path - The path to validate (e.g., "E:", "F:")
 * @returns true if valid drive path, false otherwise
 */
export function isValidDrivePath(path: string): boolean {
  // Implementation
}
```

## Test Cases to Generate

```typescript
describe('isValidDrivePath', () => {
  test('returns true for valid uppercase drive', () => {
    expect(isValidDrivePath('E:')).toBe(true);
  });

  test('returns true for valid lowercase drive', () => {
    expect(isValidDrivePath('e:')).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(isValidDrivePath('')).toBe(false);
  });

  test('returns false for invalid format', () => {
    expect(isValidDrivePath('EE:')).toBe(false);
  });
});
```

## Success Criteria
- [ ] Function compiles without errors
- [ ] All test cases pass
- [ ] Code follows project conventions
- [ ] JSDoc is complete and accurate

## Validation Loop
1. Prompt Engineer creates prompt
2. Tool-Integrator executes via agent
3. QA Bot-Designer generates and runs tests
4. Operations Coach records metrics
5. If tests fail → return to step 1
