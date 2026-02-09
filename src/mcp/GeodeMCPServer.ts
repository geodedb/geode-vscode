/**
 * Geode MCP Server - Model Context Protocol integration for AI assistants
 *
 * This module provides MCP-compatible tools for AI assistants to interact
 * with the Geode graph database through the VS Code extension.
 */

import * as vscode from 'vscode';
import { GeodeClientWrapper } from '../client/GeodeClientWrapper';
import {
    sanitizeIdentifier as _sanitizeId,
    escapeStringValue as _escapeStr,
} from '../utils/security';

/**
 * Validate and sanitize a GQL identifier, throwing on invalid input.
 * Wrapper around shared utility for backward compatibility.
 */
function sanitizeIdentifier(value: string, type: string): string {
    return _sanitizeId(value, { type, throwOnInvalid: true })!;
}

/**
 * Escape a string value for safe GQL interpolation, throwing on overflow.
 * Wrapper around shared utility for backward compatibility.
 */
function escapeStringValue(value: string): string {
    return _escapeStr(value, true);
}

/**
 * Validate and sanitize a numeric value.
 * Returns a safe integer within specified bounds.
 *
 * @param value - The value to validate
 * @param defaultValue - Default value if input is undefined
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns A safe integer value
 */
function sanitizeNumber(value: any, defaultValue: number, min: number, max: number): number {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const num = parseInt(String(value), 10);

    if (isNaN(num)) {
        return defaultValue;
    }

    return Math.max(min, Math.min(max, num));
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required?: string[];
    };
}

/**
 * MCP Tool result
 */
export interface MCPToolResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

/**
 * Geode MCP Server implementation
 */
export class GeodeMCPServer {
    private tools: Map<string, MCPTool> = new Map();
    private resources: Map<string, MCPResource> = new Map();

    constructor(
        private client: GeodeClientWrapper,
        private outputChannel: vscode.OutputChannel
    ) {
        this.registerTools();
        this.registerResources();
    }

    /**
     * Register available tools
     */
    private registerTools(): void {
        // Query execution tool
        this.tools.set('geode_query', {
            name: 'geode_query',
            description: 'Execute a GQL (Graph Query Language) query against the Geode database. Returns results as JSON.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The GQL query to execute (e.g., MATCH (n:Person) RETURN n LIMIT 10)'
                    }
                },
                required: ['query']
            }
        });

        // Schema introspection tool
        this.tools.set('geode_schema', {
            name: 'geode_schema',
            description: 'Get the database schema including node labels, relationship types, and properties.',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        });

        // Node count tool
        this.tools.set('geode_count_nodes', {
            name: 'geode_count_nodes',
            description: 'Count nodes in the database, optionally filtered by label.',
            inputSchema: {
                type: 'object',
                properties: {
                    label: {
                        type: 'string',
                        description: 'Optional node label to filter by (e.g., Person, Company)'
                    }
                }
            }
        });

        // Relationship count tool
        this.tools.set('geode_count_relationships', {
            name: 'geode_count_relationships',
            description: 'Count relationships in the database, optionally filtered by type.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        description: 'Optional relationship type to filter by (e.g., KNOWS, WORKS_AT)'
                    }
                }
            }
        });

        // Find paths tool
        this.tools.set('geode_find_paths', {
            name: 'geode_find_paths',
            description: 'Find paths between two nodes in the graph.',
            inputSchema: {
                type: 'object',
                properties: {
                    startLabel: {
                        type: 'string',
                        description: 'Label of the start node'
                    },
                    startProperty: {
                        type: 'string',
                        description: 'Property name to match on start node'
                    },
                    startValue: {
                        type: 'string',
                        description: 'Property value to match on start node'
                    },
                    endLabel: {
                        type: 'string',
                        description: 'Label of the end node'
                    },
                    endProperty: {
                        type: 'string',
                        description: 'Property name to match on end node'
                    },
                    endValue: {
                        type: 'string',
                        description: 'Property value to match on end node'
                    },
                    maxDepth: {
                        type: 'string',
                        description: 'Maximum path length (default: 5)'
                    }
                },
                required: ['startLabel', 'startProperty', 'startValue', 'endLabel', 'endProperty', 'endValue']
            }
        });

        // Explain query tool
        this.tools.set('geode_explain', {
            name: 'geode_explain',
            description: 'Get the execution plan for a GQL query without running it.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The GQL query to explain'
                    }
                },
                required: ['query']
            }
        });

        // Create node tool
        this.tools.set('geode_create_node', {
            name: 'geode_create_node',
            description: 'Create a new node in the database.',
            inputSchema: {
                type: 'object',
                properties: {
                    label: {
                        type: 'string',
                        description: 'The label for the new node (e.g., Person, Company)'
                    },
                    properties: {
                        type: 'string',
                        description: 'JSON string of properties for the node (e.g., {"name": "Alice", "age": 30})'
                    }
                },
                required: ['label', 'properties']
            }
        });

        // Create relationship tool
        this.tools.set('geode_create_relationship', {
            name: 'geode_create_relationship',
            description: 'Create a relationship between two existing nodes.',
            inputSchema: {
                type: 'object',
                properties: {
                    fromLabel: {
                        type: 'string',
                        description: 'Label of the source node'
                    },
                    fromProperty: {
                        type: 'string',
                        description: 'Property name to identify source node'
                    },
                    fromValue: {
                        type: 'string',
                        description: 'Property value to identify source node'
                    },
                    relationshipType: {
                        type: 'string',
                        description: 'Type of the relationship (e.g., KNOWS, WORKS_AT)'
                    },
                    toLabel: {
                        type: 'string',
                        description: 'Label of the target node'
                    },
                    toProperty: {
                        type: 'string',
                        description: 'Property name to identify target node'
                    },
                    toValue: {
                        type: 'string',
                        description: 'Property value to identify target node'
                    },
                    properties: {
                        type: 'string',
                        description: 'Optional JSON string of relationship properties'
                    }
                },
                required: ['fromLabel', 'fromProperty', 'fromValue', 'relationshipType', 'toLabel', 'toProperty', 'toValue']
            }
        });
    }

    /**
     * Register available resources
     */
    private registerResources(): void {
        this.resources.set('geode://schema', {
            uri: 'geode://schema',
            name: 'Database Schema',
            description: 'Current database schema including labels, relationship types, and properties',
            mimeType: 'application/json'
        });

        this.resources.set('geode://statistics', {
            uri: 'geode://statistics',
            name: 'Database Statistics',
            description: 'Current database statistics including node and relationship counts',
            mimeType: 'application/json'
        });
    }

    /**
     * List available tools
     */
    listTools(): MCPTool[] {
        return Array.from(this.tools.values());
    }

    /**
     * List available resources
     */
    listResources(): MCPResource[] {
        return Array.from(this.resources.values());
    }

    /**
     * SECURITY: Issue #40 - Redact sensitive data from arguments before logging
     */
    private redactSensitiveArgs(args: Record<string, any>): Record<string, any> {
        const redacted = { ...args };
        const sensitiveKeys = ['password', 'token', 'secret', 'api_key', 'auth'];

        for (const key of Object.keys(redacted)) {
            // Redact known sensitive keys
            if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
                redacted[key] = '***REDACTED***';
            }
            // Redact long query strings (might contain sensitive data)
            else if (key === 'query' && typeof redacted[key] === 'string' && redacted[key].length > 100) {
                redacted[key] = redacted[key].substring(0, 100) + '... (truncated)';
            }
        }

        return redacted;
    }

    /**
     * Execute a tool
     */
    async executeTool(name: string, args: Record<string, any>): Promise<MCPToolResult> {
        // SECURITY: Issue #40 - Log with redacted sensitive arguments
        const safeArgs = this.redactSensitiveArgs(args);
        this.outputChannel.appendLine(`MCP: Executing tool ${name} with args: ${JSON.stringify(safeArgs)}`);

        try {
            switch (name) {
                case 'geode_query':
                    return await this.executeQuery(args.query);

                case 'geode_schema':
                    return await this.getSchema();

                case 'geode_count_nodes':
                    return await this.countNodes(args.label);

                case 'geode_count_relationships':
                    return await this.countRelationships(args.type);

                case 'geode_find_paths':
                    return await this.findPaths(args);

                case 'geode_explain':
                    return await this.explainQuery(args.query);

                case 'geode_create_node':
                    return await this.createNode(args.label, args.properties);

                case 'geode_create_relationship':
                    return await this.createRelationship(args);

                default:
                    return {
                        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                        isError: true
                    };
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`MCP: Tool ${name} failed: ${error.message}`);
            return {
                content: [{ type: 'text', text: `Error: ${error.message}` }],
                isError: true
            };
        }
    }

    /**
     * Read a resource
     */
    async readResource(uri: string): Promise<MCPToolResult> {
        this.outputChannel.appendLine(`MCP: Reading resource ${uri}`);

        try {
            switch (uri) {
                case 'geode://schema':
                    return await this.getSchema();

                case 'geode://statistics':
                    return await this.getStatistics();

                default:
                    return {
                        content: [{ type: 'text', text: `Unknown resource: ${uri}` }],
                        isError: true
                    };
            }
        } catch (error: any) {
            return {
                content: [{ type: 'text', text: `Error: ${error.message}` }],
                isError: true
            };
        }
    }

    // Tool implementations

    private async executeQuery(query: string): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        const result = await this.client.query(query);
        const rows = await result.toObjects();

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    columns: result.columnNames,
                    rows: rows,
                    rowCount: rows.length
                }, null, 2)
            }]
        };
    }

    private async getSchema(): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        const schema = await this.client.getSchema();
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(schema, null, 2)
            }]
        };
    }

    private async getStatistics(): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        const stats = await this.client.getStatistics();
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(stats, null, 2)
            }]
        };
    }

    private async countNodes(label?: string): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        let query: string;
        let sanitizedLabel: string | undefined;

        if (label) {
            sanitizedLabel = sanitizeIdentifier(label, 'Node label');
            query = `MATCH (n:${sanitizedLabel}) RETURN count(n) as count`;
        } else {
            query = 'MATCH (n) RETURN count(n) as count';
        }

        const result = await this.client.query(query);
        const rows = await result.toObjects();
        const count = rows[0]?.count || 0;

        return {
            content: [{
                type: 'text',
                text: `Node count${sanitizedLabel ? ` for label "${sanitizedLabel}"` : ''}: ${count}`
            }]
        };
    }

    private async countRelationships(type?: string): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        let query: string;
        let sanitizedType: string | undefined;

        if (type) {
            sanitizedType = sanitizeIdentifier(type, 'Relationship type');
            query = `MATCH ()-[r:${sanitizedType}]->() RETURN count(r) as count`;
        } else {
            query = 'MATCH ()-[r]->() RETURN count(r) as count';
        }

        const result = await this.client.query(query);
        const rows = await result.toObjects();
        const count = rows[0]?.count || 0;

        return {
            content: [{
                type: 'text',
                text: `Relationship count${sanitizedType ? ` for type "${sanitizedType}"` : ''}: ${count}`
            }]
        };
    }

    private async findPaths(args: Record<string, any>): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        // Validate and sanitize all inputs
        const startLabel = sanitizeIdentifier(args.startLabel, 'Start node label');
        const startProperty = sanitizeIdentifier(args.startProperty, 'Start node property');
        const startValue = escapeStringValue(args.startValue);
        const endLabel = sanitizeIdentifier(args.endLabel, 'End node label');
        const endProperty = sanitizeIdentifier(args.endProperty, 'End node property');
        const endValue = escapeStringValue(args.endValue);
        const maxDepth = sanitizeNumber(args.maxDepth, 5, 1, 20);

        const query = `
            MATCH (start:${startLabel} {${startProperty}: '${startValue}'})
            MATCH (end:${endLabel} {${endProperty}: '${endValue}'})
            MATCH path = shortestPath((start)-[*1..${maxDepth}]-(end))
            RETURN path
            LIMIT 5
        `;

        const result = await this.client.query(query);
        const rows = await result.toObjects();

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ paths: rows, count: rows.length }, null, 2)
            }]
        };
    }

    private async explainQuery(query: string): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        const result = await this.client.explain(query);
        const rows = await result.toObjects();

        return {
            content: [{
                type: 'text',
                text: JSON.stringify(rows, null, 2)
            }]
        };
    }

    private async createNode(label: string, propertiesJson: string): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        // Validate and sanitize label
        const sanitizedLabel = sanitizeIdentifier(label, 'Node label');

        let properties: Record<string, any>;
        try {
            properties = JSON.parse(propertiesJson);
        } catch {
            return {
                content: [{ type: 'text', text: 'Invalid JSON for properties' }],
                isError: true
            };
        }

        // Validate and sanitize property names and escape values
        const propEntries = Object.entries(properties)
            .map(([k, v]) => {
                const sanitizedKey = sanitizeIdentifier(k, 'Property name');
                if (typeof v === 'string') {
                    return `${sanitizedKey}: '${escapeStringValue(v)}'`;
                } else if (typeof v === 'number' || typeof v === 'boolean') {
                    return `${sanitizedKey}: ${v}`;
                } else if (v === null) {
                    return `${sanitizedKey}: null`;
                } else {
                    // For complex types, serialize to JSON string
                    return `${sanitizedKey}: '${escapeStringValue(JSON.stringify(v))}'`;
                }
            })
            .join(', ');

        const query = `CREATE (n:${sanitizedLabel} {${propEntries}}) RETURN n`;
        const result = await this.client.query(query);
        const rows = await result.toObjects();

        return {
            content: [{
                type: 'text',
                text: `Node created: ${JSON.stringify(rows[0], null, 2)}`
            }]
        };
    }

    private async createRelationship(args: Record<string, any>): Promise<MCPToolResult> {
        if (!this.client.isConnected()) {
            return {
                content: [{ type: 'text', text: 'Not connected to Geode database. Please connect first.' }],
                isError: true
            };
        }

        // Validate and sanitize all identifiers
        const fromLabel = sanitizeIdentifier(args.fromLabel, 'Source node label');
        const fromProperty = sanitizeIdentifier(args.fromProperty, 'Source node property');
        const fromValue = escapeStringValue(args.fromValue);
        const toLabel = sanitizeIdentifier(args.toLabel, 'Target node label');
        const toProperty = sanitizeIdentifier(args.toProperty, 'Target node property');
        const toValue = escapeStringValue(args.toValue);
        const relationshipType = sanitizeIdentifier(args.relationshipType, 'Relationship type');

        let relProps = '';
        if (args.properties) {
            try {
                const props = JSON.parse(args.properties);
                const propEntries = Object.entries(props)
                    .map(([k, v]) => {
                        const sanitizedKey = sanitizeIdentifier(k, 'Property name');
                        if (typeof v === 'string') {
                            return `${sanitizedKey}: '${escapeStringValue(v)}'`;
                        } else if (typeof v === 'number' || typeof v === 'boolean') {
                            return `${sanitizedKey}: ${v}`;
                        } else if (v === null) {
                            return `${sanitizedKey}: null`;
                        } else {
                            return `${sanitizedKey}: '${escapeStringValue(JSON.stringify(v))}'`;
                        }
                    })
                    .join(', ');
                relProps = ` {${propEntries}}`;
            } catch {
                return {
                    content: [{ type: 'text', text: 'Invalid JSON for relationship properties' }],
                    isError: true
                };
            }
        }

        const query = `
            MATCH (a:${fromLabel} {${fromProperty}: '${fromValue}'})
            MATCH (b:${toLabel} {${toProperty}: '${toValue}'})
            CREATE (a)-[r:${relationshipType}${relProps}]->(b)
            RETURN a, r, b
        `;

        const result = await this.client.query(query);
        const rows = await result.toObjects();

        return {
            content: [{
                type: 'text',
                text: `Relationship created: ${JSON.stringify(rows[0], null, 2)}`
            }]
        };
    }
}

/**
 * Register MCP server with the extension
 */
export function registerMCPServer(
    context: vscode.ExtensionContext,
    client: GeodeClientWrapper,
    outputChannel: vscode.OutputChannel
): GeodeMCPServer {
    const server = new GeodeMCPServer(client, outputChannel);

    // Register command to list MCP tools (for debugging/exploration)
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.mcp.listTools', () => {
            const tools = server.listTools();
            const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
            vscode.window.showInformationMessage(`Available MCP Tools:\n${toolList}`, { modal: true });
            outputChannel.appendLine('MCP Tools:');
            tools.forEach(t => outputChannel.appendLine(`  ${t.name}: ${t.description}`));
        })
    );

    // Register command to execute MCP tool (for testing)
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.mcp.executeTool', async () => {
            const tools = server.listTools();
            const toolName = await vscode.window.showQuickPick(
                tools.map(t => ({ label: t.name, description: t.description })),
                { placeHolder: 'Select a tool to execute' }
            );

            if (!toolName) return;

            const argsJson = await vscode.window.showInputBox({
                prompt: 'Enter tool arguments as JSON',
                placeHolder: '{"query": "MATCH (n) RETURN n LIMIT 5"}'
            });

            if (argsJson === undefined) return;

            try {
                const args = argsJson ? JSON.parse(argsJson) : {};
                const result = await server.executeTool(toolName.label, args);

                if (result.isError) {
                    vscode.window.showErrorMessage(result.content[0]?.text || 'Unknown error');
                } else {
                    // Show result in output channel
                    outputChannel.appendLine(`\nMCP Tool Result (${toolName.label}):`);
                    outputChannel.appendLine(result.content[0]?.text || 'No output');
                    outputChannel.show();
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to execute tool: ${error.message}`);
            }
        })
    );

    outputChannel.appendLine('MCP Server registered with ' + server.listTools().length + ' tools');
    return server;
}
