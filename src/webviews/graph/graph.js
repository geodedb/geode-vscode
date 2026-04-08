/**
 * Geode Graph Visualization JavaScript
 * Lightweight Canvas-based graph renderer with force-directed layout
 */

/** Return a cryptographically secure random float in [0, 1). */
function secureFloat() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] / (0xFFFFFFFF + 1);
}

// Graph state
let nodes = [];
let edges = [];
let nodeMap = new Map();

// Canvas and rendering
let canvas, ctx;
let width, height;
let dpr = window.devicePixelRatio || 1;

// View state
let offsetX = 0, offsetY = 0;
let scale = 1;
let isDragging = false;
let dragStartX, dragStartY;
let selectedNode = null;
let hoveredNode = null;
let draggingNode = null;

// Layout state
let currentLayout = 'force';
let simulationRunning = false;

// Filter state
let visibleLabels = new Set();
let visibleEdgeTypes = new Set();

// Node colors by label
const labelColors = {
    'Person': '#81c784',
    'Company': '#ffb74d',
    'Organization': '#ffb74d',
    'Location': '#ba68c8',
    'Place': '#ba68c8',
    'Event': '#f06292',
    'Product': '#4db6ac',
    'default': '#4fc3f7'
};

/**
 * Initialize the graph visualization
 */
function initGraph() {
    canvas = document.getElementById('graphCanvas');
    if (!canvas || !window.graphData) return;

    ctx = canvas.getContext('2d');

    // Process graph data
    processGraphData(window.graphData);

    // Set initial layout
    currentLayout = window.initialLayout || 'force';

    // Setup canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Setup event listeners
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel);
    canvas.addEventListener('dblclick', onDoubleClick);

    // Apply initial layout
    applyLayout(currentLayout);

    // Start render loop
    requestAnimationFrame(render);
}

/**
 * Process graph data into internal format
 */
function processGraphData(data) {
    nodes = data.nodes.map(n => ({
        ...n,
        x: n.x || secureFloat() * 500 + 100,
        y: n.y || secureFloat() * 400 + 100,
        vx: 0,
        vy: 0,
        radius: 20
    }));

    edges = data.edges.map(e => ({
        ...e,
        source: e.source,
        target: e.target
    }));

    // Build node map for quick lookup
    nodeMap.clear();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // Initialize visibility
    nodes.forEach(n => {
        (n.labels || []).forEach(l => visibleLabels.add(l));
    });
    edges.forEach(e => visibleEdgeTypes.add(e.type || 'RELATES_TO'));

    // Center view on nodes
    centerView();
}

/**
 * Resize canvas to container
 */
function resizeCanvas() {
    const container = canvas.parentElement;
    width = container.clientWidth;
    height = container.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.scale(dpr, dpr);
}

/**
 * Center the view on nodes
 */
function centerView() {
    if (nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    nodes.forEach(n => {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
    });

    const graphWidth = maxX - minX + 100;
    const graphHeight = maxY - minY + 100;

    scale = Math.min(width / graphWidth, height / graphHeight, 1.5);
    offsetX = width / 2 - (minX + maxX) / 2 * scale;
    offsetY = height / 2 - (minY + maxY) / 2 * scale;
}

/**
 * Apply layout algorithm
 */
function applyLayout(layoutType) {
    currentLayout = layoutType;

    switch (layoutType) {
        case 'force':
            startForceSimulation();
            break;
        case 'hierarchical':
            applyHierarchicalLayout();
            break;
        case 'circular':
            applyCircularLayout();
            break;
        case 'grid':
            applyGridLayout();
            break;
    }
}

/**
 * Force-directed layout simulation
 */
function startForceSimulation() {
    simulationRunning = true;
    let iterations = 0;
    const maxIterations = 300;

    function simulate() {
        if (!simulationRunning || iterations >= maxIterations) {
            simulationRunning = false;
            return;
        }

        const alpha = 1 - iterations / maxIterations;

        // Repulsion between nodes
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[j].x - nodes[i].x;
                const dy = nodes[j].y - nodes[i].y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = 500 / (dist * dist);

                const fx = dx / dist * force * alpha;
                const fy = dy / dist * force * alpha;

                nodes[i].vx -= fx;
                nodes[i].vy -= fy;
                nodes[j].vx += fx;
                nodes[j].vy += fy;
            }
        }

        // Attraction along edges
        edges.forEach(e => {
            const source = nodeMap.get(e.source);
            const target = nodeMap.get(e.target);
            if (!source || !target) return;

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (dist - 100) * 0.05 * alpha;

            const fx = dx / dist * force;
            const fy = dy / dist * force;

            source.vx += fx;
            source.vy += fy;
            target.vx -= fx;
            target.vy -= fy;
        });

        // Apply velocities with damping
        nodes.forEach(n => {
            n.x += n.vx * 0.5;
            n.y += n.vy * 0.5;
            n.vx *= 0.9;
            n.vy *= 0.9;
        });

        iterations++;
        requestAnimationFrame(simulate);
    }

    simulate();
}

/**
 * Hierarchical layout
 */
function applyHierarchicalLayout() {
    simulationRunning = false;
    const layers = [];
    const visited = new Set();

    const queue = [];
    nodes.forEach(n => {
        if (!edges.some(e => e.target === n.id)) {
            queue.push({ node: n, level: 0 });
        }
    });

    if (queue.length === 0 && nodes.length > 0) {
        queue.push({ node: nodes[0], level: 0 });
    }

    while (queue.length > 0) {
        const { node, level } = queue.shift();
        if (visited.has(node.id)) continue;
        visited.add(node.id);

        if (!layers[level]) layers[level] = [];
        layers[level].push(node);

        edges.filter(e => e.source === node.id).forEach(e => {
            const target = nodeMap.get(e.target);
            if (target && !visited.has(target.id)) {
                queue.push({ node: target, level: level + 1 });
            }
        });
    }

    const levelHeight = 100;
    layers.forEach((layer, level) => {
        layer.forEach((node, i) => {
            node.x = width / 2 + (i - layer.length / 2) * 100;
            node.y = 80 + level * levelHeight;
        });
    });

    centerView();
}

/**
 * Circular layout
 */
function applyCircularLayout() {
    simulationRunning = false;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 3;

    nodes.forEach((n, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        n.x = cx + Math.cos(angle) * radius;
        n.y = cy + Math.sin(angle) * radius;
    });

    centerView();
}

/**
 * Grid layout
 */
function applyGridLayout() {
    simulationRunning = false;
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const spacing = 100;

    nodes.forEach((n, i) => {
        n.x = (i % cols) * spacing + 100;
        n.y = Math.floor(i / cols) * spacing + 100;
    });

    centerView();
}

/**
 * Main render function
 */
function render() {
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Draw edges
    edges.forEach(e => {
        if (!visibleEdgeTypes.has(e.type || 'RELATES_TO')) return;

        const source = nodeMap.get(e.source);
        const target = nodeMap.get(e.target);
        if (!source || !target) return;
        if (!isNodeVisible(source) || !isNodeVisible(target)) return;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1 / scale;
        ctx.stroke();

        // Draw arrow
        const angle = Math.atan2(target.y - source.y, target.x - source.x);
        const arrowX = target.x - Math.cos(angle) * (target.radius + 5);
        const arrowY = target.y - Math.sin(angle) * (target.radius + 5);

        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - Math.cos(angle - 0.3) * 10, arrowY - Math.sin(angle - 0.3) * 10);
        ctx.lineTo(arrowX - Math.cos(angle + 0.3) * 10, arrowY - Math.sin(angle + 0.3) * 10);
        ctx.closePath();
        ctx.fillStyle = '#666';
        ctx.fill();
    });

    // Draw nodes
    nodes.forEach(n => {
        if (!isNodeVisible(n)) return;

        const color = getNodeColor(n);
        const isHovered = n === hoveredNode;
        const isSelected = n === selectedNode;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (isSelected) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3 / scale;
            ctx.stroke();
        } else if (isHovered) {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 2 / scale;
            ctx.stroke();
        }

        ctx.fillStyle = '#000';
        ctx.font = (12 / scale) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = String(n.id).slice(0, 3);
        ctx.fillText(label, n.x, n.y);
    });

    ctx.restore();
    requestAnimationFrame(render);
}

function isNodeVisible(node) {
    if (!node.labels || node.labels.length === 0) return true;
    return node.labels.some(l => visibleLabels.has(l));
}

function getNodeColor(node) {
    if (node.labels && node.labels.length > 0) {
        for (const label of node.labels) {
            if (labelColors[label]) return labelColors[label];
        }
    }
    return labelColors.default;
}

function screenToGraph(x, y) {
    return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
}

function getNodeAt(x, y) {
    const pos = screenToGraph(x, y);
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!isNodeVisible(n)) continue;
        const dx = pos.x - n.x;
        const dy = pos.y - n.y;
        if (dx * dx + dy * dy < n.radius * n.radius) return n;
    }
    return null;
}

function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = getNodeAt(x, y);
    if (node) {
        draggingNode = node;
        selectedNode = node;
        simulationRunning = false;
        postToExtension('nodeSelected', { node });
    } else {
        isDragging = true;
        dragStartX = x - offsetX;
        dragStartY = y - offsetY;
        canvas.classList.add('dragging');
    }
}

function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (draggingNode) {
        const pos = screenToGraph(x, y);
        draggingNode.x = pos.x;
        draggingNode.y = pos.y;
    } else if (isDragging) {
        offsetX = x - dragStartX;
        offsetY = y - dragStartY;
    } else {
        const node = getNodeAt(x, y);
        hoveredNode = node;
        canvas.classList.toggle('node-hover', !!node);

        const tooltip = document.getElementById('tooltip');
        if (node && tooltip) {
            tooltip.textContent = node.id + (node.labels ? ' [' + node.labels.join(', ') + ']' : '');
            tooltip.style.display = 'block';
            tooltip.style.left = (x + 15) + 'px';
            tooltip.style.top = (y + 15) + 'px';
        } else if (tooltip) {
            tooltip.style.display = 'none';
        }
    }
}

function onMouseUp() {
    isDragging = false;
    draggingNode = null;
    canvas.classList.remove('dragging');
}

function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = scale * delta;

    if (newScale >= 0.1 && newScale <= 5) {
        offsetX = x - (x - offsetX) * delta;
        offsetY = y - (y - offsetY) * delta;
        scale = newScale;
    }
}

function onDoubleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = getNodeAt(x, y);
    if (node) postToExtension('nodeSelected', { node });
}

window.changeLayout = function(layout) {
    applyLayout(layout);
    postToExtension('layoutChange', { layout });
};

window.zoomIn = function() {
    if (scale < 5) {
        const cx = width / 2, cy = height / 2;
        offsetX = cx - (cx - offsetX) * 1.2;
        offsetY = cy - (cy - offsetY) * 1.2;
        scale *= 1.2;
    }
};

window.zoomOut = function() {
    if (scale > 0.1) {
        const cx = width / 2, cy = height / 2;
        offsetX = cx - (cx - offsetX) / 1.2;
        offsetY = cy - (cy - offsetY) / 1.2;
        scale /= 1.2;
    }
};

window.fitToView = centerView;

window.toggleLabel = function(label, visible) {
    if (visible) visibleLabels.add(label);
    else visibleLabels.delete(label);
};

window.toggleEdgeType = function(type, visible) {
    if (visible) visibleEdgeTypes.add(type);
    else visibleEdgeTypes.delete(type);
};

window.exportPng = function() {
    const dataUrl = canvas.toDataURL('image/png');
    postToExtension('exportPng', { dataUrl });
};

window.exportSvg = function() {
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">';
    edges.forEach(e => {
        const source = nodeMap.get(e.source);
        const target = nodeMap.get(e.target);
        if (source && target) {
            svg += '<line x1="' + source.x + '" y1="' + source.y + '" x2="' + target.x + '" y2="' + target.y + '" stroke="#666" stroke-width="1"/>';
        }
    });
    nodes.forEach(n => {
        svg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.radius + '" fill="' + getNodeColor(n) + '"/>';
        svg += '<text x="' + n.x + '" y="' + n.y + '" text-anchor="middle" dominant-baseline="middle" fill="#000" font-size="12">' + String(n.id).slice(0,3) + '</text>';
    });
    svg += '</svg>';
    postToExtension('exportSvg', { svg });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGraph);
} else {
    initGraph();
}
