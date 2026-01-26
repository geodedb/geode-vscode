/**
 * Geode Query Results Table JavaScript
 */

// Track current sort state
let currentSortColumn = -1;
let sortAscending = true;

/**
 * Sort table by column.
 */
function sortColumn(columnIndex) {
    const table = document.getElementById('resultsTable');
    if (!table) return;

    const headers = table.querySelectorAll('th');
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    // Toggle direction if clicking same column
    if (currentSortColumn === columnIndex) {
        sortAscending = !sortAscending;
    } else {
        currentSortColumn = columnIndex;
        sortAscending = true;
    }

    // Update header classes
    headers.forEach((th, i) => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (i === columnIndex) {
            th.classList.add(sortAscending ? 'sorted-asc' : 'sorted-desc');
        }
    });

    // Get rows as array
    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Sort rows
    rows.sort((a, b) => {
        const aCell = a.cells[columnIndex];
        const bCell = b.cells[columnIndex];
        if (!aCell || !bCell) return 0;

        const aVal = getCellSortValue(aCell);
        const bVal = getCellSortValue(bCell);

        let result = 0;
        if (aVal === null && bVal === null) {
            result = 0;
        } else if (aVal === null) {
            result = 1;
        } else if (bVal === null) {
            result = -1;
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            result = aVal - bVal;
        } else {
            result = String(aVal).localeCompare(String(bVal));
        }

        return sortAscending ? result : -result;
    });

    // Re-append rows in sorted order
    rows.forEach(row => tbody.appendChild(row));

    // Notify extension
    postToExtension('sort', { column: columnIndex, ascending: sortAscending });
}

/**
 * Get sortable value from a cell.
 */
function getCellSortValue(cell) {
    // Check for null value
    if (cell.querySelector('.null-value')) {
        return null;
    }

    // Check for number value
    const numSpan = cell.querySelector('.number-value');
    if (numSpan) {
        return parseFloat(numSpan.textContent);
    }

    // Check for boolean value
    const boolSpan = cell.querySelector('.bool-value');
    if (boolSpan) {
        return boolSpan.textContent === 'true' ? 1 : 0;
    }

    // Use text content
    return cell.textContent.trim();
}

/**
 * Select a cell.
 */
function selectCell(cell) {
    // Deselect all cells
    document.querySelectorAll('.cell.selected').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.selected-row').forEach(r => r.classList.remove('selected-row'));

    // Select this cell
    cell.classList.add('selected');
}

/**
 * Copy cell value to clipboard.
 */
function copyCell(cell) {
    const value = getCellRawValue(cell);
    postToExtension('copyCell', { value: value });
}

/**
 * Get raw value from cell for copying.
 */
function getCellRawValue(cell) {
    // Check for truncated/tooltip value
    const truncated = cell.querySelector('.truncated-value, .array-value, .object-value');
    if (truncated && truncated.title) {
        return truncated.title;
    }

    // Check for null
    if (cell.querySelector('.null-value')) {
        return 'null';
    }

    return cell.textContent.trim();
}

/**
 * Export results to CSV.
 */
function exportCsv() {
    postToExtension('exportCsv', {});
}

/**
 * Export results to JSON.
 */
function exportJson() {
    postToExtension('exportJson', {});
}

/**
 * Handle keyboard navigation.
 */
document.addEventListener('keydown', (e) => {
    const selected = document.querySelector('.cell.selected');
    if (!selected) return;

    const row = selected.parentElement;
    const cellIndex = Array.from(row.cells).indexOf(selected);
    let newCell = null;

    switch (e.key) {
        case 'ArrowUp':
            if (row.previousElementSibling) {
                newCell = row.previousElementSibling.cells[cellIndex];
            }
            break;
        case 'ArrowDown':
            if (row.nextElementSibling) {
                newCell = row.nextElementSibling.cells[cellIndex];
            }
            break;
        case 'ArrowLeft':
            if (cellIndex > 0) {
                newCell = row.cells[cellIndex - 1];
            }
            break;
        case 'ArrowRight':
            if (cellIndex < row.cells.length - 1) {
                newCell = row.cells[cellIndex + 1];
            }
            break;
        case 'c':
            if (e.ctrlKey || e.metaKey) {
                copyCell(selected);
                e.preventDefault();
            }
            break;
        case 'Enter':
            copyCell(selected);
            break;
    }

    if (newCell) {
        selectCell(newCell);
        newCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        e.preventDefault();
    }
});

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'refresh':
            // Page will be reloaded by extension
            break;
    }
});
