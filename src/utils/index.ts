/**
 * Shared utilities for the Geode VS Code extension.
 */
export {
    // HTML escaping
    escapeHtml,
    // CSP nonce generation
    getNonce,
    // GQL sanitization
    sanitizeIdentifier,
    escapeStringValue,
    // Binary path validation
    isValidBinaryPath,
    // Error formatting
    formatError,
    // Constants
    GQL_IDENTIFIER_PATTERN,
    MAX_IDENTIFIER_LENGTH,
    MAX_STRING_VALUE_LENGTH,
    DEFAULT_PORT,
    CONNECTION_TIMEOUT_MS,
    QUERY_TIMEOUT_MS,
} from './security';
