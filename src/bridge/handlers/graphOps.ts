import type { BridgeHost } from '../host'
import { QueryRunner } from './queryExecute'

export function buildExpandQuery(nodeId: string, labels: string[], depth: number): string {
    const label = labels[0] ?? 'Node'
    return `MATCH (n:${label} {_id:'${nodeId}'})-[r*1..${Math.max(1, depth)}]-(m) RETURN n, r, m LIMIT 100`
}

export function buildRelatedQuery(nodeId: string, relationshipType?: string): string {
    const rel = relationshipType ? `:${relationshipType}` : ''
    return `MATCH (n {_id:'${nodeId}'})-[r${rel}]-(m) RETURN n, r, m LIMIT 100`
}

interface RawNode { _id?: string | number; _labels?: string[]; labels?: string[]; properties?: Record<string, unknown> }
interface RawRel { _id?: string | number; _type?: string; type?: string; _start?: string | number; _end?: string | number; properties?: Record<string, unknown> }
type Cell = RawNode | RawRel | unknown

function isNode(v: Cell): v is RawNode {
    if (!v || typeof v !== 'object') return false
    const obj = v as Record<string, unknown>
    return ('_labels' in obj || 'labels' in obj) && !('_type' in obj) && !('type' in obj && '_start' in obj)
}
function isRel(v: Cell): v is RawRel {
    if (!v || typeof v !== 'object') return false
    const obj = v as Record<string, unknown>
    return '_type' in obj || ('type' in obj && '_start' in obj)
}

export interface GraphNode { id: string; labels: string[]; properties: Record<string, unknown> }
export interface GraphEdge { id: string; source: string; target: string; type: string; properties: Record<string, unknown> }
export interface GraphElements { nodes: GraphNode[]; edges: GraphEdge[] }

export function extractGraph(rows: Array<Record<string, Cell>>): GraphElements {
    const nodes = new Map<string, GraphNode>()
    const edges: GraphEdge[] = []
    for (const row of rows) {
        for (const value of Object.values(row)) {
            const stack = Array.isArray(value) ? value : [value]
            for (const item of stack) {
                if (isNode(item)) {
                    const node = item as RawNode
                    const id = String(node._id ?? `n-${nodes.size}`)
                    if (!nodes.has(id)) {
                        nodes.set(id, {
                            id,
                            labels: node._labels ?? node.labels ?? [],
                            properties: node.properties ?? (node as unknown as Record<string, unknown>),
                        })
                    }
                }
                if (isRel(item)) {
                    const rel = item as RawRel
                    edges.push({
                        id: String(rel._id ?? `e-${edges.length}`),
                        source: String(rel._start ?? ''),
                        target: String(rel._end ?? ''),
                        type: String(rel._type ?? rel.type ?? ''),
                        properties: rel.properties ?? (rel as unknown as Record<string, unknown>),
                    })
                }
            }
        }
    }
    return { nodes: [...nodes.values()], edges }
}

export function createGraphOpsHandlers(deps: { runner: QueryRunner }) {
    return {
        expand: async (payload: { nodeId: string; labels?: string[]; depth?: number }) => {
            const stmt = buildExpandQuery(payload.nodeId, payload.labels ?? [], payload.depth ?? 1)
            const result = await deps.runner.run(stmt)
            return extractGraph(result.rows as Array<Record<string, Cell>>)
        },
        related: async (payload: { nodeId: string; relationshipType?: string }) => {
            const stmt = buildRelatedQuery(payload.nodeId, payload.relationshipType)
            const result = await deps.runner.run(stmt)
            return extractGraph(result.rows as Array<Record<string, Cell>>)
        },
    }
}

export function registerGraphOpsHandlers(host: BridgeHost, deps: { runner: QueryRunner }): void {
    const h = createGraphOpsHandlers(deps)
    host.register('graph.expand', h.expand)
    host.register('graph.related', h.related)
}
