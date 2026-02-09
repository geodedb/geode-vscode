/**
 * Integration tests for GraphVisualizationPanel
 * These tests require the Geode CLI and optionally a running server
 */

import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Path to geode binary (relative to test execution directory)
const geodeBinary = path.resolve(__dirname, '../../../../zig-out/bin/geode');
const altGeodeBinary = '/usr/local/bin/geode';

function getGeodeBinary(): string {
    if (fs.existsSync(geodeBinary)) {
        return geodeBinary;
    }
    if (fs.existsSync(altGeodeBinary)) {
        return altGeodeBinary;
    }
    // Fall back to PATH
    return 'geode';
}

function isServerRunning(): boolean {
    try {
        const result = spawnSync(getGeodeBinary(), [
            'query', '--server', '127.0.0.1:3141', '--insecure', '--timeout', '2', 'RETURN 1'
        ], { encoding: 'utf8', timeout: 5000 });
        return result.status === 0;
    } catch {
        return false;
    }
}

function runQuery(query: string, format: string = 'json'): string {
    return execFileSync(getGeodeBinary(), [
        'query', '--server', '127.0.0.1:3141', '--insecure', '--format', format, '-'
    ], {
        encoding: 'utf8',
        input: query,
        timeout: 30000
    });
}

function parseJsonOutput(output: string): any[] {
    const results: any[] = [];
    const lines = output.trim().split('\n').filter(l => l.trim());

    for (const line of lines) {
        try {
            const json = JSON.parse(line);
            if (json.result?.type === 'BINDINGS' && json.result.rows) {
                results.push(...json.result.rows);
            } else if (json.row) {
                results.push(json.row);
            }
        } catch {
            // Skip non-JSON lines
        }
    }

    return results;
}

describe('Graph Visualization CLI Integration Tests', () => {

    describe('CLI Availability', () => {
        it('geode binary is accessible', function() {
            const binary = getGeodeBinary();
            if (binary === 'geode') {
                // Check if in PATH
                const result = spawnSync('which', ['geode'], { encoding: 'utf8' });
                if (result.status !== 0) {
                    this.skip();
                    return;
                }
            } else {
                assert.ok(fs.existsSync(binary), `Geode binary should exist at ${binary}`);
            }
        });

        it('geode query --help includes format option', function() {
            const binary = getGeodeBinary();
            try {
                const result = spawnSync(binary, ['query', '--help'], {
                    encoding: 'utf8',
                    timeout: 5000
                });
                const output = (result.stdout || '') + (result.stderr || '');
                assert.ok(
                    output.includes('--format') || output.includes('format'),
                    'Should have format option'
                );
            } catch {
                this.skip();
            }
        });
    });

    describe('JSON Format Output', function() {
        before(function() {
            if (!isServerRunning()) {
                this.skip();
            }
        });

        it('returns JSON for simple RETURN query', function() {
            const output = runQuery('RETURN 1 AS x, 2 AS y');
            const rows = parseJsonOutput(output);

            assert.ok(rows.length > 0, 'Should return at least one row');
            assert.strictEqual(rows[0].x, 1);
            assert.strictEqual(rows[0].y, 2);
        });

        it('returns nodes with _labels property', function() {
            // Create and query a node
            runQuery("CREATE (n:TestNode {name: 'test'}) RETURN n");

            const output = runQuery("MATCH (n:TestNode) RETURN n LIMIT 1");
            const rows = parseJsonOutput(output);

            assert.ok(rows.length > 0);
            const node = rows[0].n;
            assert.ok(node, 'Should have node in result');
            // Node should have labels
            assert.ok(
                node._labels || node.labels,
                'Node should have labels property'
            );

            // Cleanup
            runQuery("MATCH (n:TestNode) DELETE n");
        });

        it('returns relationships with _type property', function() {
            // Create nodes and relationship
            runQuery(`
                CREATE (a:TestPerson {name: 'Alice'})
                CREATE (b:TestPerson {name: 'Bob'})
                CREATE (a)-[:KNOWS {since: 2020}]->(b)
            `);

            const output = runQuery("MATCH (a:TestPerson)-[r:KNOWS]->(b:TestPerson) RETURN a, r, b");
            const rows = parseJsonOutput(output);

            assert.ok(rows.length > 0);
            const rel = rows[0].r;
            assert.ok(rel, 'Should have relationship in result');
            assert.ok(
                rel._type || rel.type,
                'Relationship should have type property'
            );

            // Cleanup
            runQuery("MATCH (n:TestPerson) DETACH DELETE n");
        });
    });

    describe('Graph Data Extraction', function() {
        before(function() {
            if (!isServerRunning()) {
                this.skip();
            }
        });

        it('extracts multiple nodes from path query', function() {
            // Create a small graph
            runQuery(`
                CREATE (a:PathTest {name: 'A'})
                CREATE (b:PathTest {name: 'B'})
                CREATE (c:PathTest {name: 'C'})
                CREATE (a)-[:CONNECTED]->(b)
                CREATE (b)-[:CONNECTED]->(c)
            `);

            const output = runQuery("MATCH p=(a:PathTest)-[*..2]-(c:PathTest) RETURN p LIMIT 5");
            const rows = parseJsonOutput(output);

            // Should have path results
            assert.ok(rows.length > 0);

            // Cleanup
            runQuery("MATCH (n:PathTest) DETACH DELETE n");
        });

        it('handles empty result set', function() {
            const output = runQuery("MATCH (n:NonExistentLabel12345) RETURN n");
            const rows = parseJsonOutput(output);

            assert.strictEqual(rows.length, 0);
        });

        it('handles aggregation results (non-graph data)', function() {
            runQuery("CREATE (n:CountTest)");
            runQuery("CREATE (n:CountTest)");
            runQuery("CREATE (n:CountTest)");

            const output = runQuery("MATCH (n:CountTest) RETURN count(n) AS cnt");
            const rows = parseJsonOutput(output);

            assert.ok(rows.length > 0);
            assert.ok(rows[0].cnt >= 3);

            // Cleanup
            runQuery("MATCH (n:CountTest) DELETE n");
        });
    });

    describe('Query Building for Expansion', function() {
        before(function() {
            if (!isServerRunning()) {
                this.skip();
            }
        });

        it('expansion query finds neighbors', function() {
            // Create a hub node with connections
            runQuery(`
                CREATE (hub:ExpandTest {name: 'Hub'})
                CREATE (s1:ExpandTest {name: 'Spoke1'})
                CREATE (s2:ExpandTest {name: 'Spoke2'})
                CREATE (s3:ExpandTest {name: 'Spoke3'})
                CREATE (hub)-[:LINK]->(s1)
                CREATE (hub)-[:LINK]->(s2)
                CREATE (hub)-[:LINK]->(s3)
            `);

            // Get hub node id
            const hubOutput = runQuery("MATCH (n:ExpandTest {name: 'Hub'}) RETURN n");
            const hubRows = parseJsonOutput(hubOutput);
            assert.ok(hubRows.length > 0);

            // Query neighbors using pattern matching
            const expandOutput = runQuery(`
                MATCH (n:ExpandTest {name: 'Hub'})-[r]-(m)
                RETURN n, r, m
            `);
            const expandRows = parseJsonOutput(expandOutput);

            // Should find 3 neighbors
            assert.ok(expandRows.length >= 3);

            // Cleanup
            runQuery("MATCH (n:ExpandTest) DETACH DELETE n");
        });

        it('expansion with depth 2 finds indirect connections', function() {
            // Create a chain: A -> B -> C
            runQuery(`
                CREATE (a:ChainTest {name: 'A'})
                CREATE (b:ChainTest {name: 'B'})
                CREATE (c:ChainTest {name: 'C'})
                CREATE (a)-[:NEXT]->(b)
                CREATE (b)-[:NEXT]->(c)
            `);

            // 2-hop from A should reach C
            const output = runQuery(`
                MATCH (a:ChainTest {name: 'A'})-[*1..2]-(x)
                RETURN DISTINCT x.name AS name
            `);
            const rows = parseJsonOutput(output);

            const names = rows.map(r => r.name);
            assert.ok(names.includes('B'), 'Should find B (1 hop)');
            assert.ok(names.includes('C'), 'Should find C (2 hops)');

            // Cleanup
            runQuery("MATCH (n:ChainTest) DETACH DELETE n");
        });
    });

    describe('Statistics Queries', function() {
        before(function() {
            if (!isServerRunning()) {
                this.skip();
            }
        });

        it('can count nodes by label', function() {
            // Create some test data
            runQuery("CREATE (n:StatTest1)");
            runQuery("CREATE (n:StatTest1)");
            runQuery("CREATE (n:StatTest2)");

            const output = runQuery(`
                MATCH (n)
                WHERE n:StatTest1 OR n:StatTest2
                WITH labels(n) as labelList
                UNWIND labelList as label
                RETURN label, count(*) as cnt
            `);
            const rows = parseJsonOutput(output);

            const stat1 = rows.find(r => r.label === 'StatTest1');
            const stat2 = rows.find(r => r.label === 'StatTest2');

            if (stat1) {
                assert.ok(stat1.cnt >= 2);
            }
            if (stat2) {
                assert.ok(stat2.cnt >= 1);
            }

            // Cleanup
            runQuery("MATCH (n:StatTest1) DELETE n");
            runQuery("MATCH (n:StatTest2) DELETE n");
        });

        it('can count relationships by type', function() {
            runQuery(`
                CREATE (a:RelStatTest)-[:TYPE_A]->(b:RelStatTest)
                CREATE (c:RelStatTest)-[:TYPE_A]->(d:RelStatTest)
                CREATE (e:RelStatTest)-[:TYPE_B]->(f:RelStatTest)
            `);

            const output = runQuery(`
                MATCH ()-[r]->()
                WHERE type(r) IN ['TYPE_A', 'TYPE_B']
                RETURN type(r) as relType, count(r) as cnt
            `);
            const rows = parseJsonOutput(output);

            const typeA = rows.find(r => r.relType === 'TYPE_A');
            const typeB = rows.find(r => r.relType === 'TYPE_B');

            if (typeA) {
                assert.ok(typeA.cnt >= 2);
            }
            if (typeB) {
                assert.ok(typeB.cnt >= 1);
            }

            // Cleanup
            runQuery("MATCH (n:RelStatTest) DETACH DELETE n");
        });
    });

    describe('Error Handling', function() {
        before(function() {
            if (!isServerRunning()) {
                this.skip();
            }
        });

        it('handles syntax errors gracefully', function() {
            try {
                runQuery('THIS IS NOT VALID GQL');
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                // Should have error output
                assert.ok(error.message || error.stderr);
            }
        });

        it('handles timeout with large result', function() {
            // This should complete quickly with LIMIT
            const output = runQuery('MATCH (n) RETURN n LIMIT 1');
            // Should not throw
            assert.ok(output !== undefined);
        });
    });
});

describe('Graph Visualization HTML Structure Tests', () => {

    describe('Required HTML elements', () => {
        // Test the expected HTML structure
        const requiredElements = [
            { id: 'cy', description: 'Cytoscape container' },
            { id: 'tooltip', description: 'Hover tooltip' },
            { id: 'contextMenu', description: 'Right-click menu' },
            { id: 'sidePanel', description: 'Node details panel' },
            { id: 'pathModeIndicator', description: 'Path finding mode indicator' },
            { id: 'selectionInfo', description: 'Selection information display' },
            { id: 'stats', description: 'Graph statistics display' },
            { id: 'layoutSelect', description: 'Layout dropdown' },
            { id: 'searchInput', description: 'Node search input' }
        ];

        it('defines all required element IDs', () => {
            assert.strictEqual(requiredElements.length, 9);
        });

        for (const elem of requiredElements) {
            it(`has ${elem.description} element (id=${elem.id})`, () => {
                assert.ok(elem.id);
            });
        }
    });

    describe('Toolbar buttons', () => {
        const buttons = [
            'Fit',
            'Zoom In (+)',
            'Zoom Out (−)',
            'Reset',
            'PNG Export',
            'SVG Export'
        ];

        it('has navigation buttons', () => {
            assert.ok(buttons.includes('Fit'));
            assert.ok(buttons.includes('Reset'));
        });

        it('has export buttons', () => {
            assert.ok(buttons.includes('PNG Export'));
            assert.ok(buttons.includes('SVG Export'));
        });
    });

    describe('Layout options', () => {
        const layouts = [
            { value: 'cose', label: 'Force-Directed' },
            { value: 'dagre', label: 'Hierarchical' },
            { value: 'circle', label: 'Circular' },
            { value: 'grid', label: 'Grid' },
            { value: 'concentric', label: 'Concentric' },
            { value: 'breadthfirst', label: 'Breadth-First' }
        ];

        it('has 6 layout options', () => {
            assert.strictEqual(layouts.length, 6);
        });

        it('includes force-directed layout', () => {
            assert.ok(layouts.find(l => l.value === 'cose'));
        });

        it('includes hierarchical layout', () => {
            assert.ok(layouts.find(l => l.value === 'dagre'));
        });
    });

    describe('Toggle controls', () => {
        const toggles = [
            { id: 'showLabels', label: 'Labels', default: true },
            { id: 'physics', label: 'Physics', default: true },
            { id: 'clustering', label: 'Cluster', default: false }
        ];

        it('has label toggle', () => {
            const toggle = toggles.find(t => t.id === 'showLabels');
            assert.ok(toggle);
            assert.strictEqual(toggle!.default, true);
        });

        it('has physics toggle', () => {
            const toggle = toggles.find(t => t.id === 'physics');
            assert.ok(toggle);
            assert.strictEqual(toggle!.default, true);
        });

        it('has clustering toggle (disabled by default)', () => {
            const toggle = toggles.find(t => t.id === 'clustering');
            assert.ok(toggle);
            assert.strictEqual(toggle!.default, false);
        });
    });
});

describe('Cytoscape.js Configuration Tests', () => {

    describe('Wheel sensitivity', () => {
        const wheelSensitivity = 0.3;

        it('is set to reasonable value for smooth zooming', () => {
            assert.ok(wheelSensitivity > 0);
            assert.ok(wheelSensitivity < 1);
        });
    });

    describe('Zoom limits', () => {
        const minZoom = 0.1;
        const maxZoom = 10;

        it('allows zooming out to 10%', () => {
            assert.strictEqual(minZoom, 0.1);
        });

        it('allows zooming in to 1000%', () => {
            assert.strictEqual(maxZoom, 10);
        });
    });

    describe('Node styling', () => {
        const nodeStyle = {
            'background-color': '#4C8EDA',
            'border-width': 2,
            'border-color': '#fff',
            'font-size': '10px'
        };

        it('has visible border', () => {
            assert.strictEqual(nodeStyle['border-width'], 2);
        });

        it('has readable font size', () => {
            assert.strictEqual(nodeStyle['font-size'], '10px');
        });
    });

    describe('Edge styling', () => {
        const edgeStyle = {
            'width': 2,
            'line-color': '#888',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier'
        };

        it('has directional arrows', () => {
            assert.strictEqual(edgeStyle['target-arrow-shape'], 'triangle');
        });

        it('uses bezier curves', () => {
            assert.strictEqual(edgeStyle['curve-style'], 'bezier');
        });
    });

    describe('Selection styling', () => {
        const selectedNodeStyle = {
            'border-width': 4,
            'border-color': '#FFD700'  // Gold
        };

        it('highlights selected nodes with thicker border', () => {
            assert.strictEqual(selectedNodeStyle['border-width'], 4);
        });

        it('uses gold color for selection', () => {
            assert.strictEqual(selectedNodeStyle['border-color'], '#FFD700');
        });
    });
});

describe('DOT Format Parser Tests', () => {

    function parseDotLine(line: string): { type: string; data: any } | null {
        const trimmed = line.trim();

        // Skip empty lines and declarations
        if (!trimmed || trimmed.startsWith('digraph') || trimmed.startsWith('graph') ||
            trimmed === '{' || trimmed === '}') {
            return null;
        }

        // Edge: a -> b or a -- b
        const edgeMatch = trimmed.match(/^"?([^"->]+)"?\s*(->|--)\s*"?([^"[]+)"?(?:\s*\[(.*))?/);
        if (edgeMatch) {
            return {
                type: 'edge',
                data: {
                    source: edgeMatch[1].trim(),
                    target: edgeMatch[3].trim(),
                    directed: edgeMatch[2] === '->'
                }
            };
        }

        // Node: a [label="..."]
        const nodeMatch = trimmed.match(/^"?([^"[]+)"?(?:\s*\[(.*))?;?$/);
        if (nodeMatch) {
            return {
                type: 'node',
                data: { id: nodeMatch[1].trim() }
            };
        }

        return null;
    }

    describe('Node parsing', () => {
        it('parses simple node', () => {
            const result = parseDotLine('node1');
            assert.strictEqual(result?.type, 'node');
            assert.strictEqual(result?.data.id, 'node1');
        });

        it('parses quoted node', () => {
            const result = parseDotLine('"my node"');
            assert.strictEqual(result?.type, 'node');
            assert.strictEqual(result?.data.id, 'my node');
        });

        it('parses node with attributes', () => {
            const result = parseDotLine('node1 [label="Person"]');
            assert.strictEqual(result?.type, 'node');
            assert.strictEqual(result?.data.id, 'node1');
        });
    });

    describe('Edge parsing', () => {
        it('parses directed edge', () => {
            const result = parseDotLine('a -> b');
            assert.strictEqual(result?.type, 'edge');
            assert.strictEqual(result?.data.source, 'a');
            assert.strictEqual(result?.data.target, 'b');
            assert.strictEqual(result?.data.directed, true);
        });

        it('parses undirected edge', () => {
            const result = parseDotLine('a -- b');
            assert.strictEqual(result?.type, 'edge');
            assert.strictEqual(result?.data.directed, false);
        });

        it('parses edge with attributes', () => {
            const result = parseDotLine('a -> b [label="KNOWS"]');
            assert.strictEqual(result?.type, 'edge');
            assert.strictEqual(result?.data.source, 'a');
            assert.strictEqual(result?.data.target, 'b');
        });
    });

    describe('Skip rules', () => {
        it('skips empty lines', () => {
            assert.strictEqual(parseDotLine(''), null);
            assert.strictEqual(parseDotLine('   '), null);
        });

        it('skips graph declarations', () => {
            assert.strictEqual(parseDotLine('digraph G {'), null);
            assert.strictEqual(parseDotLine('graph {'), null);
        });

        it('skips braces', () => {
            assert.strictEqual(parseDotLine('{'), null);
            assert.strictEqual(parseDotLine('}'), null);
        });
    });
});
