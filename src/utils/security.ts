/**
 * Shared security and sanitization utilities for the Geode VS Code extension.
 *
 * Consolidates escapeHtml, getNonce, sanitizeIdentifier, escapeStringValue,
 * validateBinaryPath, and formatError into a single module to eliminate
 * duplication and ensure consistent security behavior.
 *
 * @module utils/security
 */

import * as crypto from 'crypto';
import * as path from 'path';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Valid pattern for GQL identifiers (labels, relationship types, property names). */
export const GQL_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Maximum length for GQL identifiers to prevent DoS via excessively long inputs. */
export const MAX_IDENTIFIER_LENGTH = 128;

/** Maximum length for string values in GQL queries. */
export const MAX_STRING_VALUE_LENGTH = 10000;

/** Default Geode server port. */
export const DEFAULT_PORT = 3141;

/** Default connection timeout in milliseconds. */
export const CONNECTION_TIMEOUT_MS = 5000;

/** Default query timeout in milliseconds. */
export const QUERY_TIMEOUT_MS = 30000;

/** CSP nonce length in bytes (produces 32 base64url characters). */
const NONCE_BYTES = 24;

// ─── Secure Random Helpers ─────────────────────────────────────────────────

/**
 * Generate a cryptographically secure unique identifier.
 *
 * Replaces the weak `Math.random().toString(36).substr(2, 9)` pattern with
 * `crypto.randomUUID()`, which produces a v4 UUID via a CSPRNG.
 *
 * @param prefix - Optional prefix (e.g., "conn", "query", "saved").
 * @returns A string like `prefix-<uuid>` or just `<uuid>`.
 */
export function secureId(prefix?: string): string {
    const uuid = crypto.randomUUID();
    return prefix ? `${prefix}-${uuid}` : uuid;
}

/**
 * Generate a cryptographically secure random integer in [0, max).
 *
 * Uses `crypto.getRandomValues()` to avoid the weak PRNG of `Math.random()`.
 * The result is uniformly distributed over the range by rejection sampling.
 *
 * @param max - Exclusive upper bound (must be > 0).
 * @returns An integer from 0 (inclusive) to max (exclusive).
 */
export function secureRandomInt(max: number): number {
    if (max <= 0) {
        return 0;
    }
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] % max;
}

/**
 * Generate a cryptographically secure random float in [0, 1).
 *
 * Uses `crypto.getRandomValues()` to produce a value equivalent to
 * `Math.random()` but backed by a CSPRNG.
 *
 * @returns A float from 0 (inclusive) to 1 (exclusive).
 */
export function secureRandomFloat(): number {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] / (0xFFFFFFFF + 1);
}

// ─── HTML Escaping ──────────────────────────────────────────────────────────

/**
 * Escape a string for safe insertion into HTML content.
 *
 * Handles null/undefined gracefully and escapes all five HTML-sensitive characters:
 * `&`, `<`, `>`, `"`, `'`.
 *
 * @param text - The text to escape. Null/undefined returns empty string.
 * @returns The HTML-escaped string.
 */
export function escapeHtml(text: string | null | undefined): string {
    if (text === null || text === undefined) {
        return '';
    }
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// ─── CSP Nonce Generation ───────────────────────────────────────────────────

/**
 * Generate a cryptographically secure nonce for Content Security Policy.
 *
 * Uses `crypto.randomBytes()` instead of `Math.random()` to produce
 * unpredictable values suitable for CSP script/style nonces.
 *
 * @returns A 32-character base64url-encoded nonce string.
 */
export function getNonce(): string {
    return crypto.randomBytes(NONCE_BYTES).toString('base64url');
}

// ─── GQL Identifier Sanitization ────────────────────────────────────────────

/**
 * Validate and sanitize a GQL identifier (label, relationship type, property name).
 *
 * Two modes of operation:
 * - **Strict mode** (`throwOnInvalid: true`): Throws descriptive errors. Use in
 *   MCP tools and schema operations where the caller handles errors.
 * - **Lenient mode** (`throwOnInvalid: false`, default): Returns `null` on
 *   invalid input. Use in panels and UI code for graceful degradation.
 *
 * @param value - The identifier to validate.
 * @param options - Optional config: `type` for error messages, `throwOnInvalid`.
 * @returns The trimmed identifier, or `null` if invalid in lenient mode.
 * @throws Error if invalid and `throwOnInvalid` is true.
 */
export function sanitizeIdentifier(
    value: string | undefined | null,
    options?: { type?: string; throwOnInvalid?: boolean }
): string | null {
    const type = options?.type ?? 'identifier';
    const throwOnInvalid = options?.throwOnInvalid ?? false;

    if (!value || typeof value !== 'string') {
        if (throwOnInvalid) {
            throw new Error(`${type} is required`);
        }
        return null;
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
        if (throwOnInvalid) {
            throw new Error(`${type} cannot be empty`);
        }
        return null;
    }

    if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
        if (throwOnInvalid) {
            throw new Error(`${type} exceeds maximum length of ${MAX_IDENTIFIER_LENGTH} characters`);
        }
        return null;
    }

    if (!GQL_IDENTIFIER_PATTERN.test(trimmed)) {
        if (throwOnInvalid) {
            throw new Error(
                `Invalid ${type}: "${trimmed}". Must start with a letter and contain only ` +
                `alphanumeric characters and underscores.`
            );
        }
        return null;
    }

    return trimmed;
}

// ─── GQL String Value Escaping ──────────────────────────────────────────────

/**
 * Escape a string value for safe interpolation in GQL queries.
 *
 * Escapes backslashes and single quotes by doubling them. Enforces a maximum
 * length to prevent DoS via excessively long values.
 *
 * Two modes of operation:
 * - **Strict mode** (`throwOnOverflow: true`): Throws on oversized values.
 *   Use in MCP tools where the caller reports errors.
 * - **Lenient mode** (`throwOnOverflow: false`, default): Truncates to limit.
 *   Use in panels/UI code.
 *
 * @param value - The string to escape. Null/undefined returns empty string.
 * @param throwOnOverflow - If true, throws instead of truncating.
 * @returns The escaped string.
 */
export function escapeStringValue(
    value: string | null | undefined,
    throwOnOverflow = false
): string {
    if (value === null || value === undefined) {
        return '';
    }

    const strValue = String(value);

    if (strValue.length > MAX_STRING_VALUE_LENGTH) {
        if (throwOnOverflow) {
            throw new Error(`String value exceeds maximum length of ${MAX_STRING_VALUE_LENGTH} characters`);
        }
        return strValue.substring(0, MAX_STRING_VALUE_LENGTH)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "''");
    }

    return strValue
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "''");
}

// ─── Binary Path Validation ─────────────────────────────────────────────────

/** Patterns that indicate potentially malicious binary paths. */
const SUSPICIOUS_PATH_PATTERNS = [
    /[;&|`$]/,                         // Shell metacharacters
    /\.\.[/\\]/,                       // Path traversal
    /^(sh|bash|zsh|cmd|powershell)/i,  // Direct shell execution
];

/** Allowed geode binary basenames. */
const VALID_BINARY_NAMES = ['geode', 'geode.exe', 'geode.sh', 'geode.bat'];

/**
 * Validate that a binary path doesn't contain suspicious patterns.
 *
 * Defense-in-depth against malicious workspace settings that attempt
 * command injection via the configured geode binary path.
 *
 * @param binaryPath - The path to validate.
 * @returns `true` if the path appears safe, `false` otherwise.
 */
export function isValidBinaryPath(binaryPath: string): boolean {
    const basename = path.basename(binaryPath).toLowerCase();

    if (VALID_BINARY_NAMES.includes(basename)) {
        // Even valid names must pass metachar and traversal checks
        for (let i = 0; i < 2; i++) {
            if (SUSPICIOUS_PATH_PATTERNS[i].test(binaryPath)) {
                return false;
            }
        }
        return true;
    }

    // Reject non-geode script extensions
    if (/\.(sh|bat|cmd|ps1)$/i.test(binaryPath)) {
        return false;
    }

    for (const pattern of SUSPICIOUS_PATH_PATTERNS) {
        if (pattern.test(binaryPath)) {
            return false;
        }
    }

    return true;
}

// ─── Error Formatting ───────────────────────────────────────────────────────

/**
 * Format an error for display to the user.
 *
 * Consistently extracts a human-readable message from various error types
 * (Error objects, strings, unknown values).
 *
 * @param error - The error to format.
 * @param prefix - Optional prefix (e.g., "Geode:").
 * @returns A formatted error string.
 */
export function formatError(error: unknown, prefix?: string): string {
    let message: string;

    if (error instanceof Error) {
        message = error.message;
    } else if (typeof error === 'string') {
        message = error;
    } else {
        message = String(error);
    }

    return prefix ? `${prefix} ${message}` : message;
}
