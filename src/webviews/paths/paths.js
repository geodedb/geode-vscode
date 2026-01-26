// Path Explorer Client Script

function searchPaths() {
    const params = {
        sourceNode: document.getElementById('sourceNode').value,
        targetNode: document.getElementById('targetNode').value,
        relationshipTypes: document.getElementById('relTypes').value
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0),
        maxDepth: parseInt(document.getElementById('maxDepth').value) || 5,
        pathType: document.getElementById('pathType').value
    };

    postToExtension('searchPaths', { params });
}

function togglePath(index) {
    postToExtension('expandPath', { pathIndex: index });
}

function applyPattern(pattern) {
    // Parse the pattern and populate the form
    const depthMatch = pattern.match(/\*(\d+)?(?:\.\.(\d+))?/);
    if (depthMatch) {
        const maxDepth = depthMatch[2] || depthMatch[1] || 5;
        document.getElementById('maxDepth').value = maxDepth;
    }

    if (pattern.includes('shortestPath')) {
        document.getElementById('pathType').value = 'shortest';
    } else if (pattern.includes('allShortestPaths')) {
        document.getElementById('pathType').value = 'all';
    }

    // Extract relationship type if present
    const relMatch = pattern.match(/:(\w+)/);
    if (relMatch) {
        document.getElementById('relTypes').value = relMatch[1];
    }
}

// Enter key triggers search
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        const active = document.activeElement;
        if (active && active.tagName === 'INPUT') {
            searchPaths();
        }
    }
});

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'pathsUpdated':
            // Content will be refreshed by the panel
            break;
    }
});
