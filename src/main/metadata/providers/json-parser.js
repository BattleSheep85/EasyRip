/**
 * Robust JSON Parser for LLM Responses
 * Handles various output formats from different LLM models
 */

import logger from '../../logger.js';

const log = {
  info: (msg, data) => logger.info('json-parser', msg, data),
  warn: (msg, data) => logger.warn('json-parser', msg, data),
  debug: (msg, data) => logger.debug('json-parser', msg, data),
};

/**
 * Expected fields for disc identification response
 */
const EXPECTED_FIELDS = ['title', 'confidence'];

/**
 * Extract and parse JSON from LLM response
 * Uses multiple strategies to find valid JSON in various response formats
 *
 * @param {string} response - Raw LLM response string
 * @param {string[]} expectedFields - Fields the JSON should contain (default: title, confidence)
 * @returns {Object|null} Parsed JSON object or null if extraction fails
 */
export function extractJSON(response, expectedFields = EXPECTED_FIELDS) {
  if (!response || typeof response !== 'string') {
    log.warn('Invalid response: not a string');
    return null;
  }

  const trimmed = response.trim();
  log.debug(`Attempting to parse response (${trimmed.length} chars)`);

  // Strategy 1: Direct JSON parse (cleanest case)
  const directResult = tryDirectParse(trimmed);
  if (directResult && hasExpectedFields(directResult, expectedFields)) {
    log.debug('Strategy 1 success: direct JSON parse');
    return directResult;
  }

  // Strategy 2: Extract from markdown code block (```json ... ```)
  const codeBlockResult = tryCodeBlockExtract(trimmed);
  if (codeBlockResult && hasExpectedFields(codeBlockResult, expectedFields)) {
    log.debug('Strategy 2 success: markdown code block');
    return codeBlockResult;
  }

  // Strategy 3: Find JSON object with expected fields
  const fieldMatchResult = tryFieldMatch(trimmed, expectedFields);
  if (fieldMatchResult) {
    log.debug('Strategy 3 success: field match extraction');
    return fieldMatchResult;
  }

  // Strategy 4: Find last valid JSON object (reasoning usually comes first)
  const lastJsonResult = tryLastJsonObject(trimmed);
  if (lastJsonResult && hasExpectedFields(lastJsonResult, expectedFields)) {
    log.debug('Strategy 4 success: last JSON object');
    return lastJsonResult;
  }

  // Strategy 5: Aggressive bracket matching
  const bracketResult = tryBracketMatch(trimmed);
  if (bracketResult && hasExpectedFields(bracketResult, expectedFields)) {
    log.debug('Strategy 5 success: bracket matching');
    return bracketResult;
  }

  log.warn('All JSON extraction strategies failed', {
    responsePreview: trimmed.substring(0, 200)
  });
  return null;
}

/**
 * Try direct JSON.parse
 */
function tryDirectParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Extract JSON from markdown code block
 * Handles: ```json{...}``` or ```{...}```
 */
function tryCodeBlockExtract(text) {
  // Match ```json ... ``` or ``` ... ``` with JSON inside
  const patterns = [
    /```json\s*([\s\S]*?)\s*```/i,
    /```\s*(\{[\s\S]*?\})\s*```/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Find JSON object containing expected fields
 */
function tryFieldMatch(text, expectedFields) {
  // Build regex to find objects with the first expected field
  const primaryField = expectedFields[0];
  const fieldPattern = new RegExp(
    `\\{[^{}]*["']${primaryField}["']\\s*:[^{}]*\\}|` +
    `\\{[^{}]*["']${primaryField}["']\\s*:[^{}]*\\{[^{}]*\\}[^{}]*\\}`,
    'g'
  );

  const matches = text.match(fieldPattern);
  if (!matches) return null;

  // Try each match
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match);
      if (hasExpectedFields(parsed, expectedFields)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Find the last valid JSON object in the text
 * Many models put reasoning first, then JSON
 */
function tryLastJsonObject(text) {
  const objects = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.substring(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (typeof parsed === 'object' && parsed !== null) {
            objects.push(parsed);
          }
        } catch {
          // Not valid JSON, continue
        }
        start = -1;
      }
    }
  }

  // Return the last valid object (most likely to be the intended output)
  return objects.length > 0 ? objects[objects.length - 1] : null;
}

/**
 * Aggressive bracket matching - handles nested objects
 */
function tryBracketMatch(text) {
  // Find all potential JSON start positions
  const starts = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      starts.push(i);
    }
  }

  // Try each start position, find matching end
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') {
          depth--;
          if (depth === 0) {
            const candidate = text.substring(start, i + 1);
            try {
              return JSON.parse(candidate);
            } catch {
              break; // This start position didn't work, try next
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Check if object has expected fields
 */
function hasExpectedFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return false;
  return fields.some(field => field in obj);
}

/**
 * Normalize identification result with defaults
 * @param {Object} parsed - Parsed JSON object
 * @returns {Object} Normalized result with all expected fields
 */
export function normalizeIdentificationResult(parsed) {
  if (!parsed) {
    return {
      title: null,
      year: null,
      type: 'movie',
      confidence: 0,
      reasoning: 'Failed to parse LLM response',
      tvInfo: null,
      hasMultipleVersions: false
    };
  }

  return {
    title: parsed.title || null,
    year: parsed.year || null,
    type: parsed.type || 'movie',
    confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
    reasoning: parsed.reasoning || '',
    tvInfo: parsed.tvInfo || null,
    hasMultipleVersions: parsed.hasMultipleVersions || false
  };
}

export default { extractJSON, normalizeIdentificationResult };
