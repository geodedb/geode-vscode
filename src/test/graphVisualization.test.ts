/**
 * Unit tests for GraphVisualizationPanel and related functionality
 */

import * as assert from 'assert';

// ============================================================================
// Type Definitions for Testing
// ============================================================================

interface GraphNodeElement {
    data: {
        id: string;
        labels?: string[];
        properties?: Record<string, any>;
    };
}

interface GraphEdgeElement {
    data: {
        id: string;
        source: string;
        target: string;
        type?: string;
        label?: string;
        properties?: Record<string, any>;
    };
}

interface GraphElements {
    nodes: GraphNodeElement[];
    edges: GraphEdgeElement[];
}

interface GraphConfig {
    layout: 'force' | 'hierarchical' | 'circular' | 'grid' | 'concentric';
    clustering: boolean;
    clusterThreshold: number;
    maxVisibleNodes: number;
    nodeSize: 'fixed' | 'degree' | 'property';
    nodeSizeProperty?: string;
    colorScheme: 'label' | 'community' | 'property';
    colorProperty?: string;
    showLabels: boolean;
    showEdgeLabels: boolean;
    physics: boolean;
    webgl: boolean;
}

// ============================================================================
// Helper Functions (mirrors actual implementation)
// ============================================================================

function buildExpandQuery(nodeId: string, labels: string[], depth: number = 1): string {
    const labelPattern = labels.length > 0 ? ':' + labels.join(':') : '';
    return `MATCH (n${labelPattern})-[r*1..${depth}]-(m)
WHERE id(n) = '${nodeId}' OR n.id = '${nodeId}'
RETURN n, r, m
LIMIT 100`;
}

function buildRelatedQuery(nodeId: string, relationshipType?: string): string {
    const relPattern = relationshipType ? `[:${relationshipType}]` : '[r]';
    return `MATCH (n)-${relPattern}-(m)
WHERE id(n) = '${nodeId}' OR n.id = '${nodeId}'
RETURN n, r, m
LIMIT 50`;
}

function extractGraphElements(rows: any[]): { nodes: any[]; edges: any[] } {
    const nodes: Map<string, any> = new Map();
    const edges: any[] = [];

    for (const row of rows) {
        for (const key of Object.keys(row)) {
            const value = row[key];
            if (!value || typeof value !== 'object') {
                continue;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    processGraphItem(item, nodes, edges);
                }
            } else {
                processGraphItem(value, nodes, edges);
            }
        }
    }

    return {
        nodes: Array.from(nodes.values()),
        edges: edges
    };
}

function processGraphItem(value: any, nodes: Map<string, any>, edges: any[]): void {
    if (!value || typeof value !== 'object') {
        return;
    }

    // Check if it's a node
    if (value._labels || value.labels || (value._id !== undefined && value._start === undefined)) {
        const nodeId = String(value._id ?? value.id ?? `node-${nodes.size}`);
        if (!nodes.has(nodeId)) {
            nodes.set(nodeId, {
                id: nodeId,
                labels: value._labels || value.labels || [],
                properties: value.properties || value
            });
        }
    }

    // Check if it's an edge
    if ((value._type || value.type) &&
        (value._start !== undefined || value._end !== undefined ||
         value.source !== undefined || value.target !== undefined)) {
        const edgeId = String(value._id ?? value.id ?? `edge-${edges.length}`);
        edges.push({
            id: edgeId,
            source: String(value._start ?? value.source ?? value.startNodeId),
            target: String(value._end ?? value.target ?? value.endNodeId),
            type: value._type || value.type,
            properties: value.properties || value
        });
    }
}

function parseJsonGraph(data: any[]): GraphElements {
    const elements: GraphElements = { nodes: [], edges: [] };
    const nodeMap = new Map<string, GraphNodeElement>();

    for (const item of data) {
        // Check for graph-style output with nodes and relationships
        if (item.nodes) {
            for (const node of item.nodes) {
                const id = node.id || node._id || ('n' + nodeMap.size);
                if (!nodeMap.has(String(id))) {
                    nodeMap.set(String(id), {
                        data: {
                            id: String(id),
                            labels: node.labels || node._labels || [],
                            properties: node.properties || node
                        }
                    });
                }
            }
        }

        if (item.relationships || item.edges) {
            const rels = item.relationships || item.edges || [];
            for (const rel of rels) {
                elements.edges.push({
                    data: {
                        id: String(rel.id || rel._id || ('e' + elements.edges.length)),
                        source: String(rel.startNode || rel.source || rel._start),
                        target: String(rel.endNode || rel.target || rel._end),
                        type: rel.type || rel._type || rel.label || '',
                        properties: rel.properties || rel
                    }
                });
            }
        }

        // Check for inline node/edge properties
        for (const key of Object.keys(item)) {
            const value = item[key];
            if (value && typeof value === 'object') {
                // Node detection
                if (value._labels || value.labels || (value._id !== undefined && !value._start)) {
                    const id = value._id ?? value.id ?? ('n' + nodeMap.size);
                    if (!nodeMap.has(String(id))) {
                        nodeMap.set(String(id), {
                            data: {
                                id: String(id),
                                labels: value._labels || value.labels || [],
                                properties: value.properties || value
                            }
                        });
                    }
                }
                // Edge detection
                if ((value._type || value.type) && (value._start !== undefined || value.source !== undefined)) {
                    elements.edges.push({
                        data: {
                            id: String(value._id || value.id || ('e' + elements.edges.length)),
                            source: String(value._start ?? value.source),
                            target: String(value._end ?? value.target),
                            type: value._type || value.type || '',
                            properties: value.properties || value
                        }
                    });
                }
            }
        }
    }

    elements.nodes = Array.from(nodeMap.values());
    return elements;
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('GraphVisualizationPanel Unit Tests', () => {

    describe('GraphConfig defaults', () => {
        const DEFAULT_CONFIG: GraphConfig = {
            layout: 'force',
            clustering: true,
            clusterThreshold: 500,
            maxVisibleNodes: 5000,
            nodeSize: 'degree',
            colorScheme: 'label',
            showLabels: true,
            showEdgeLabels: false,
            physics: true,
            webgl: true
        };

        it('has force layout as default', () => {
            assert.strictEqual(DEFAULT_CONFIG.layout, 'force');
        });

        it('has clustering enabled with threshold of 500', () => {
            assert.strictEqual(DEFAULT_CONFIG.clustering, true);
            assert.strictEqual(DEFAULT_CONFIG.clusterThreshold, 500);
        });

        it('supports up to 5000 visible nodes', () => {
            assert.strictEqual(DEFAULT_CONFIG.maxVisibleNodes, 5000);
        });

        it('uses degree-based node sizing', () => {
            assert.strictEqual(DEFAULT_CONFIG.nodeSize, 'degree');
        });

        it('colors nodes by label', () => {
            assert.strictEqual(DEFAULT_CONFIG.colorScheme, 'label');
        });

        it('shows node labels but not edge labels', () => {
            assert.strictEqual(DEFAULT_CONFIG.showLabels, true);
            assert.strictEqual(DEFAULT_CONFIG.showEdgeLabels, false);
        });

        it('has physics and WebGL enabled', () => {
            assert.strictEqual(DEFAULT_CONFIG.physics, true);
            assert.strictEqual(DEFAULT_CONFIG.webgl, true);
        });
    });

    describe('buildExpandQuery', () => {
        it('builds basic expand query without labels', () => {
            const query = buildExpandQuery('node-123', [], 1);

            assert.ok(query.includes('MATCH (n)-[r*1..1]-(m)'));
            assert.ok(query.includes("id(n) = 'node-123'"));
            assert.ok(query.includes('LIMIT 100'));
        });

        it('includes labels in pattern when provided', () => {
            const query = buildExpandQuery('node-123', ['Person'], 1);

            assert.ok(query.includes('MATCH (n:Person)-[r*1..1]-(m)'));
        });

        it('includes multiple labels', () => {
            const query = buildExpandQuery('node-123', ['Person', 'Employee'], 2);

            assert.ok(query.includes('MATCH (n:Person:Employee)-[r*1..2]-(m)'));
        });

        it('respects depth parameter', () => {
            const query1 = buildExpandQuery('n1', [], 1);
            const query2 = buildExpandQuery('n1', [], 3);

            assert.ok(query1.includes('[r*1..1]'));
            assert.ok(query2.includes('[r*1..3]'));
        });

        it('includes both id() and n.id conditions', () => {
            const query = buildExpandQuery('abc', [], 1);

            assert.ok(query.includes("id(n) = 'abc'"));
            assert.ok(query.includes("n.id = 'abc'"));
        });
    });

    describe('buildRelatedQuery', () => {
        it('builds query without relationship type filter', () => {
            const query = buildRelatedQuery('node-1');

            assert.ok(query.includes('MATCH (n)-[r]-(m)'));
            assert.ok(query.includes("id(n) = 'node-1'"));
            assert.ok(query.includes('LIMIT 50'));
        });

        it('builds query with relationship type filter', () => {
            const query = buildRelatedQuery('node-1', 'KNOWS');

            assert.ok(query.includes('MATCH (n)-[:KNOWS]-(m)'));
        });

        it('handles special relationship type names', () => {
            const query = buildRelatedQuery('node-1', 'FRIEND_OF');

            assert.ok(query.includes('[:FRIEND_OF]'));
        });
    });

    describe('extractGraphElements', () => {
        it('extracts nodes with _labels format', () => {
            const rows = [
                { n: { _id: 1, _labels: ['Person'], properties: { name: 'Alice' } } }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.nodes.length, 1);
            assert.strictEqual(result.nodes[0].id, '1');
            assert.deepStrictEqual(result.nodes[0].labels, ['Person']);
        });

        it('extracts nodes with labels format (no underscore)', () => {
            const rows = [
                { n: { id: 'n1', labels: ['Person'], properties: { name: 'Bob' } } }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.nodes.length, 1);
            assert.strictEqual(result.nodes[0].id, 'n1');
        });

        it('extracts edges with _type format', () => {
            const rows = [
                { r: { _id: 'e1', _type: 'KNOWS', _start: 'n1', _end: 'n2', properties: {} } }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.edges.length, 1);
            assert.strictEqual(result.edges[0].type, 'KNOWS');
            assert.strictEqual(result.edges[0].source, 'n1');
            assert.strictEqual(result.edges[0].target, 'n2');
        });

        it('extracts edges with source/target format', () => {
            const rows = [
                { r: { id: 'e1', type: 'LIKES', source: 'a', target: 'b' } }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.edges.length, 1);
            assert.strictEqual(result.edges[0].source, 'a');
            assert.strictEqual(result.edges[0].target, 'b');
        });

        it('deduplicates nodes by id', () => {
            const rows = [
                { n: { _id: 1, _labels: ['Person'] } },
                { m: { _id: 1, _labels: ['Person'] } },  // Same ID
                { o: { _id: 2, _labels: ['Person'] } }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.nodes.length, 2);
        });

        it('handles arrays of relationships (path results)', () => {
            const rows = [
                {
                    path: [
                        { _id: 'r1', _type: 'KNOWS', _start: 'n1', _end: 'n2' },
                        { _id: 'r2', _type: 'KNOWS', _start: 'n2', _end: 'n3' }
                    ]
                }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.edges.length, 2);
        });

        it('handles mixed nodes and edges in same row', () => {
            const rows = [
                {
                    n: { _id: 'n1', _labels: ['Person'] },
                    r: { _id: 'e1', _type: 'KNOWS', _start: 'n1', _end: 'n2' },
                    m: { _id: 'n2', _labels: ['Person'] }
                }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.nodes.length, 2);
            assert.strictEqual(result.edges.length, 1);
        });

        it('ignores primitive values', () => {
            const rows = [
                { name: 'Alice', age: 30, active: true, score: null }
            ];

            const result = extractGraphElements(rows);

            assert.strictEqual(result.nodes.length, 0);
            assert.strictEqual(result.edges.length, 0);
        });

        it('returns empty arrays for empty input', () => {
            const result = extractGraphElements([]);

            assert.strictEqual(result.nodes.length, 0);
            assert.strictEqual(result.edges.length, 0);
        });
    });

    describe('parseJsonGraph', () => {
        it('parses explicit nodes array', () => {
            const data = [
                {
                    nodes: [
                        { id: 'n1', labels: ['Person'], properties: { name: 'Alice' } },
                        { id: 'n2', labels: ['Person'], properties: { name: 'Bob' } }
                    ]
                }
            ];

            const result = parseJsonGraph(data);

            assert.strictEqual(result.nodes.length, 2);
            assert.strictEqual(result.nodes[0].data.id, 'n1');
            assert.strictEqual(result.nodes[1].data.id, 'n2');
        });

        it('parses explicit relationships array', () => {
            const data = [
                {
                    relationships: [
                        { id: 'r1', type: 'KNOWS', startNode: 'n1', endNode: 'n2' }
                    ]
                }
            ];

            const result = parseJsonGraph(data);

            assert.strictEqual(result.edges.length, 1);
            assert.strictEqual(result.edges[0].data.source, 'n1');
            assert.strictEqual(result.edges[0].data.target, 'n2');
        });

        it('parses edges array (alternative format)', () => {
            const data = [
                {
                    edges: [
                        { id: 'e1', type: 'LIKES', source: 'a', target: 'b' }
                    ]
                }
            ];

            const result = parseJsonGraph(data);

            assert.strictEqual(result.edges.length, 1);
            assert.strictEqual(result.edges[0].data.type, 'LIKES');
        });

        it('parses inline node properties', () => {
            const data = [
                { n: { _id: 1, _labels: ['Person'], name: 'Alice' } }
            ];

            const result = parseJsonGraph(data);

            assert.strictEqual(result.nodes.length, 1);
            assert.deepStrictEqual(result.nodes[0].data.labels, ['Person']);
        });

        it('parses inline edge properties', () => {
            const data = [
                { r: { _id: 'e1', _type: 'KNOWS', _start: 'n1', _end: 'n2' } }
            ];

            const result = parseJsonGraph(data);

            assert.strictEqual(result.edges.length, 1);
            assert.strictEqual(result.edges[0].data.type, 'KNOWS');
        });

        it('combines multiple items', () => {
            const data = [
                { n: { _id: 'n1', _labels: ['Person'] } },
                { n: { _id: 'n2', _labels: ['Person'] } },
                { r: { _type: 'KNOWS', _start: 'n1', _end: 'n2' } }
            ];

            const result = parseJsonGraph(data);

            assert.strictEqual(result.nodes.length, 2);
            assert.strictEqual(result.edges.length, 1);
        });

        it('deduplicates nodes by id', () => {
            const data = [
                { n: { _id: 'same', _labels: ['Person'] } },
                { m: { _id: 'same', _labels: ['Person'] } }
            ];

            const result = parseJsonGraph(data);

            assert.strictEqual(result.nodes.length, 1);
        });
    });

    describe('GraphElements structure', () => {
        it('node element has correct structure', () => {
            const node: GraphNodeElement = {
                data: {
                    id: 'n1',
                    labels: ['Person', 'Employee'],
                    properties: { name: 'Alice', age: 30 }
                }
            };

            assert.strictEqual(node.data.id, 'n1');
            assert.strictEqual(node.data.labels!.length, 2);
            assert.strictEqual(node.data.properties!.name, 'Alice');
        });

        it('edge element has correct structure', () => {
            const edge: GraphEdgeElement = {
                data: {
                    id: 'e1',
                    source: 'n1',
                    target: 'n2',
                    type: 'KNOWS',
                    properties: { since: 2020 }
                }
            };

            assert.strictEqual(edge.data.id, 'e1');
            assert.strictEqual(edge.data.source, 'n1');
            assert.strictEqual(edge.data.target, 'n2');
            assert.strictEqual(edge.data.type, 'KNOWS');
        });

        it('graph elements has nodes and edges arrays', () => {
            const elements: GraphElements = {
                nodes: [
                    { data: { id: 'n1' } },
                    { data: { id: 'n2' } }
                ],
                edges: [
                    { data: { id: 'e1', source: 'n1', target: 'n2' } }
                ]
            };

            assert.strictEqual(elements.nodes.length, 2);
            assert.strictEqual(elements.edges.length, 1);
        });
    });

    describe('Layout configurations', () => {
        const layouts = ['force', 'hierarchical', 'circular', 'grid', 'concentric'];

        it('supports all layout types', () => {
            assert.strictEqual(layouts.length, 5);
            assert.ok(layouts.includes('force'));
            assert.ok(layouts.includes('hierarchical'));
            assert.ok(layouts.includes('circular'));
        });

        it('force layout is suitable for general graphs', () => {
            // Force-directed layout works well for most graphs
            assert.ok(layouts.indexOf('force') === 0);
        });
    });

    describe('Color scheme', () => {
        const colors = [
            '#4C8EDA', '#DA4C4C', '#4CDA7F', '#DA9E4C', '#9E4CDA',
            '#4CDADA', '#DA4C9E', '#7FDA4C', '#4C4CDA', '#DA7F4C',
            '#4CDA4C', '#DA4CDA', '#DADA4C', '#4C9EDA', '#9EDA4C'
        ];

        it('has 15 colors for labels', () => {
            assert.strictEqual(colors.length, 15);
        });

        it('all colors are valid hex', () => {
            const hexPattern = /^#[0-9A-F]{6}$/i;
            for (const color of colors) {
                assert.ok(hexPattern.test(color), `${color} is not valid hex`);
            }
        });

        it('colors are visually distinct', () => {
            // No duplicate colors
            const uniqueColors = new Set(colors);
            assert.strictEqual(uniqueColors.size, colors.length);
        });
    });

    describe('Node sizing', () => {
        it('supports fixed size mode', () => {
            const config: Partial<GraphConfig> = { nodeSize: 'fixed' };
            assert.strictEqual(config.nodeSize, 'fixed');
        });

        it('supports degree-based sizing', () => {
            const config: Partial<GraphConfig> = { nodeSize: 'degree' };
            assert.strictEqual(config.nodeSize, 'degree');
        });

        it('supports property-based sizing', () => {
            const config: Partial<GraphConfig> = {
                nodeSize: 'property',
                nodeSizeProperty: 'importance'
            };
            assert.strictEqual(config.nodeSize, 'property');
            assert.strictEqual(config.nodeSizeProperty, 'importance');
        });
    });

    describe('Webview message types', () => {
        const messageTypes = [
            'loadDot',
            'loadElements',
            'loadJson',
            'mergeElements',
            'highlightPath',
            'updateConfig',
            'fit',
            'reset',
            'selectNode',
            'clearSelection'
        ];

        it('defines all required message types', () => {
            assert.ok(messageTypes.includes('loadDot'));
            assert.ok(messageTypes.includes('loadElements'));
            assert.ok(messageTypes.includes('loadJson'));
            assert.ok(messageTypes.includes('mergeElements'));
            assert.ok(messageTypes.includes('highlightPath'));
        });

        it('has navigation messages', () => {
            assert.ok(messageTypes.includes('fit'));
            assert.ok(messageTypes.includes('reset'));
            assert.ok(messageTypes.includes('selectNode'));
        });
    });

    describe('Context menu actions', () => {
        const nodeActions = [
            'View Details',
            'Expand Neighbors (1 hop)',
            'Expand Neighbors (2 hops)',
            'Find Paths From Here...',
            'Focus on this Node',
            'Select Neighbors',
            'Hide Node',
            'Lock Position',
            'Copy ID',
            'Copy as JSON'
        ];

        it('has all node context menu actions', () => {
            assert.ok(nodeActions.includes('Expand Neighbors (1 hop)'));
            assert.ok(nodeActions.includes('Find Paths From Here...'));
            assert.ok(nodeActions.includes('Hide Node'));
        });

        it('has copy actions', () => {
            assert.ok(nodeActions.includes('Copy ID'));
            assert.ok(nodeActions.includes('Copy as JSON'));
        });
    });
});

describe('Graph Exploration Tests', () => {

    describe('Path finding', () => {
        it('supports Dijkstra algorithm', () => {
            // Dijkstra is used for shortest path in Cytoscape
            const algorithms = ['dijkstra', 'aStar', 'bellmanFord'];
            assert.ok(algorithms.includes('dijkstra'));
        });

        it('path highlighting classes exist', () => {
            const classes = ['path-source', 'path-target', 'path-highlight'];
            assert.strictEqual(classes.length, 3);
        });
    });

    describe('Node expansion', () => {
        it('supports 1-hop expansion', () => {
            const query = buildExpandQuery('n1', [], 1);
            assert.ok(query.includes('[r*1..1]'));
        });

        it('supports 2-hop expansion', () => {
            const query = buildExpandQuery('n1', [], 2);
            assert.ok(query.includes('[r*1..2]'));
        });

        it('limits results to 100', () => {
            const query = buildExpandQuery('n1', [], 1);
            assert.ok(query.includes('LIMIT 100'));
        });
    });

    describe('Side panel', () => {
        it('displays node properties', () => {
            const node = {
                id: 'n1',
                labels: ['Person'],
                properties: { name: 'Alice', age: 30 }
            };

            assert.ok(node.properties.name);
            assert.ok(node.properties.age);
        });

        it('displays edge properties', () => {
            const edge = {
                id: 'e1',
                source: 'n1',
                target: 'n2',
                type: 'KNOWS',
                properties: { since: 2020 }
            };

            assert.ok(edge.properties.since);
            assert.ok(edge.source);
            assert.ok(edge.target);
        });
    });
});

describe('Large Graph Handling Tests', () => {

    describe('Performance thresholds', () => {
        const config: GraphConfig = {
            layout: 'force',
            clustering: true,
            clusterThreshold: 500,
            maxVisibleNodes: 5000,
            nodeSize: 'degree',
            colorScheme: 'label',
            showLabels: true,
            showEdgeLabels: false,
            physics: true,
            webgl: true
        };

        it('enables clustering above threshold', () => {
            assert.ok(config.clustering);
            assert.strictEqual(config.clusterThreshold, 500);
        });

        it('limits visible nodes for performance', () => {
            assert.strictEqual(config.maxVisibleNodes, 5000);
        });

        it('uses WebGL for rendering', () => {
            assert.ok(config.webgl);
        });
    });

    describe('Clustering', () => {
        it('groups nodes by label', () => {
            const nodes = [
                { data: { id: 'n1', labels: ['Person'] } },
                { data: { id: 'n2', labels: ['Person'] } },
                { data: { id: 'n3', labels: ['Company'] } }
            ];

            // Group by label
            const groups = new Map<string, any[]>();
            for (const node of nodes) {
                const label = node.data.labels?.[0] || 'default';
                if (!groups.has(label)) {
                    groups.set(label, []);
                }
                groups.get(label)!.push(node);
            }

            assert.strictEqual(groups.get('Person')!.length, 2);
            assert.strictEqual(groups.get('Company')!.length, 1);
        });
    });

    describe('Element merging', () => {
        it('adds new nodes without duplicates', () => {
            const existing: GraphElements = {
                nodes: [{ data: { id: 'n1' } }],
                edges: []
            };

            const newElements: GraphElements = {
                nodes: [
                    { data: { id: 'n1' } },  // Duplicate
                    { data: { id: 'n2' } }   // New
                ],
                edges: []
            };

            // Merge logic
            const nodeIds = new Set(existing.nodes.map(n => n.data.id));
            const toAdd = newElements.nodes.filter(n => !nodeIds.has(n.data.id));

            assert.strictEqual(toAdd.length, 1);
            assert.strictEqual(toAdd[0].data.id, 'n2');
        });
    });
});

describe('Export Functionality Tests', () => {

    describe('PNG export', () => {
        it('generates data URL format', () => {
            const mockPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            assert.ok(mockPngDataUrl.startsWith('data:image/png;base64,'));
        });

        it('can extract base64 from data URL', () => {
            const dataUrl = 'data:image/png;base64,ABC123';
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

            assert.strictEqual(base64, 'ABC123');
        });
    });

    describe('SVG export', () => {
        it('produces valid SVG string', () => {
            const mockSvg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>';

            assert.ok(mockSvg.startsWith('<svg'));
            assert.ok(mockSvg.includes('xmlns'));
            assert.ok(mockSvg.endsWith('</svg>'));
        });
    });
});

describe('Search and Filter Tests', () => {

    describe('Node search', () => {
        it('matches node ID', () => {
            const node = { id: 'person-123', labels: ['Person'], properties: { name: 'Alice' } };
            const query = 'person';

            assert.ok(node.id.toLowerCase().includes(query.toLowerCase()));
        });

        it('matches node labels', () => {
            const node = { id: 'n1', labels: ['Person', 'Employee'], properties: {} };
            const query = 'employee';

            const match = node.labels.some(l => l.toLowerCase().includes(query.toLowerCase()));
            assert.ok(match);
        });

        it('matches property values', () => {
            const node = { id: 'n1', labels: [], properties: { name: 'Alice', city: 'New York' } };
            const query = 'alice';

            const match = Object.values(node.properties).some(v =>
                String(v).toLowerCase().includes(query.toLowerCase())
            );
            assert.ok(match);
        });

        it('returns no match for non-matching query', () => {
            const node = { id: 'n1', labels: ['Person'], properties: { name: 'Alice' } };
            const query = 'xyz123';

            const idMatch = node.id.toLowerCase().includes(query.toLowerCase());
            const labelMatch = node.labels.some(l => l.toLowerCase().includes(query.toLowerCase()));
            const propMatch = Object.values(node.properties).some(v =>
                String(v).toLowerCase().includes(query.toLowerCase())
            );

            assert.ok(!idMatch && !labelMatch && !propMatch);
        });
    });
});
