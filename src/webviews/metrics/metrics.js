// Performance Metrics Dashboard Client Script

let autoRefreshActive = false;

function toggleAutoRefresh() {
    const btn = document.getElementById('autoRefreshBtn');
    if (autoRefreshActive) {
        postToExtension('stopAutoRefresh');
        btn.textContent = '▶ Auto-Refresh';
        btn.classList.remove('active');
    } else {
        postToExtension('startAutoRefresh', { interval: 5000 });
        btn.textContent = '⏹ Stop';
        btn.classList.add('active');
    }
    autoRefreshActive = !autoRefreshActive;
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            updateMetrics(message.metrics);
            break;
    }
});

function updateMetrics(metrics) {
    // Update query performance
    updateElement('queriesPerSec', metrics.queriesPerSec.toFixed(1));
    updateElement('avgLatency', metrics.avgLatencyMs.toFixed(2) + ' ms');
    updateElement('p95Latency', metrics.p95LatencyMs.toFixed(2) + ' ms');
    updateElement('p99Latency', metrics.p99LatencyMs.toFixed(2) + ' ms');

    // Update connections
    updateElement('activeConns', metrics.activeConnections);
    updateElement('idleConns', metrics.idleConnections);
    updateElement('totalConns', metrics.totalConnections);
    updateElement('peakConns', metrics.peakConnections);

    // Update memory
    updateElement('heapUsed', formatBytes(metrics.heapUsedBytes));
    updateElement('heapTotal', formatBytes(metrics.heapTotalBytes));
    updateElement('bufferPool', formatBytes(metrics.bufferPoolBytes));

    // Update storage
    updateElement('dataSize', formatBytes(metrics.dataSizeBytes));
    updateElement('indexSize', formatBytes(metrics.indexSizeBytes));
    updateElement('walSize', formatBytes(metrics.walSizeBytes));
    updateElement('cacheHitRate', (metrics.cacheHitRate * 100).toFixed(1) + '%');

    // Update graph stats
    updateElement('totalNodes', formatNumber(metrics.totalNodes));
    updateElement('totalEdges', formatNumber(metrics.totalEdges));
    updateElement('nodeLabels', metrics.nodeLabels);
    updateElement('edgeTypes', metrics.edgeTypes);

    // Update transactions
    updateElement('activeTxs', metrics.activeTransactions);
    updateElement('commitsPerSec', metrics.commitsPerSec.toFixed(1));
    updateElement('rollbacksPerSec', metrics.rollbacksPerSec.toFixed(1));
    updateElement('lockWaits', metrics.lockWaits);
}

function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return bytes.toFixed(1) + ' ' + units[i];
}

function formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
}
