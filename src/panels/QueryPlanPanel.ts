// CANARY: REQ=REQ-VSCODE-QUERY-PLAN-001; FEATURE="QueryPlanVisualization"; ASPECT=VSCodeIntegration; STATUS=IMPL; OWNER=tooling; UPDATED=2026-01-03
import * as vscode from 'vscode';

/**
 * Query Plan Visualization Panel
 * Displays query execution plans with visual tree representation
 */

export interface PlanNode {
    id: string;
    operator: string;
    estimatedRows: number;
    actualRows?: number;
    time?: number;
    children?: PlanNode[];
    details?: Record<string, unknown>;
}

export class QueryPlanPanel {
    public static currentPanel: QueryPlanPanel | undefined;
    private static readonly viewType = 'geodeQueryPlan';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private planData: PlanNode | null = null;

    public static createOrShow(extensionUri: vscode.Uri, planData?: PlanNode): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (QueryPlanPanel.currentPanel) {
            QueryPlanPanel.currentPanel._panel.reveal(column);
            if (planData) {
                QueryPlanPanel.currentPanel.updatePlan(planData);
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            QueryPlanPanel.viewType,
            'Query Execution Plan',
            column || vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        QueryPlanPanel.currentPanel = new QueryPlanPanel(panel, extensionUri, planData);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, planData?: PlanNode) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.planData = planData || null;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible) {
                this._update();
            }
        }, null, this._disposables);
    }

    public updatePlan(planData: PlanNode): void {
        this.planData = planData;
        this._update();
    }

    private _update(): void {
        this._panel.webview.html = this._getHtmlContent();
        // SECURITY: Use postMessage to send data instead of inlining JSON
        // This prevents XSS via malicious content in planData
        this._panel.webview.postMessage({
            type: 'updatePlan',
            data: this.planData || this.getExamplePlan()
        });
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private _getHtmlContent(): string {
        const nonce = this.getNonce();
        // SECURITY: Data is now passed via postMessage instead of inline JSON
        // to prevent XSS attacks (Issue #31)

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Query Execution Plan</title>
    <style nonce="${nonce}">
        body { font-family: var(--vscode-font-family); padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
        .header { display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
        h1 { margin: 0; font-size: 18px; }
        .plan-node { background: var(--vscode-editor-background); border: 2px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px 16px; margin: 8px 0; min-width: 200px; }
        .plan-node.hot { border-color: #ff6b6b; }
        .plan-node.warm { border-color: #feca57; }
        .operator-name { font-weight: bold; font-size: 14px; color: var(--vscode-textLink-foreground); margin-bottom: 8px; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 12px; }
        .stat-label { color: var(--vscode-descriptionForeground); }
        .children { margin-top: 16px; padding-left: 20px; border-left: 2px solid var(--vscode-panel-border); }
        .empty-state { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
    </style>
</head>
<body>
    <div class="header"><h1>Query Execution Plan</h1></div>
    <div id="planContainer"></div>
    <script nonce="${nonce}">
        // SECURITY: Receive data via postMessage instead of inline JSON
        let planData = null;

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updatePlan') {
                planData = message.data;
                const container = document.getElementById('planContainer');
                // SECURITY: Clear container safely without using risky DOM methods
                while (container.firstChild) {
                    container.removeChild(container.firstChild);
                }
                if (planData) {
                    render(planData, container, getMax(planData));
                }
            }
        });

        function render(node, container, totalRows) {
            if (!node) { container.textContent = 'No plan data'; return; }
            const nodeEl = document.createElement('div');
            nodeEl.className = 'plan-node ' + (node.estimatedRows > totalRows * 0.5 ? 'hot' : node.estimatedRows > totalRows * 0.1 ? 'warm' : '');
            const opName = document.createElement('div');
            opName.className = 'operator-name';
            opName.textContent = node.operator;
            nodeEl.appendChild(opName);
            const stats = document.createElement('div');
            stats.className = 'stats';
            const label = document.createElement('span');
            label.className = 'stat-label';
            label.textContent = 'Est. Rows:';
            const value = document.createElement('span');
            value.textContent = String(node.estimatedRows);
            stats.appendChild(label);
            stats.appendChild(value);
            nodeEl.appendChild(stats);
            container.appendChild(nodeEl);
            if (node.children && node.children.length > 0) {
                const childContainer = document.createElement('div');
                childContainer.className = 'children';
                node.children.forEach(child => render(child, childContainer, totalRows));
                nodeEl.appendChild(childContainer);
            }
        }
        function getMax(node) { return Math.max(node.estimatedRows || 0, ...(node.children || []).map(getMax)); }
    </script>
</body>
</html>`;
    }

    private getExamplePlan(): PlanNode {
        return {
            id: 'root', operator: 'ProduceResults', estimatedRows: 100,
            children: [{ id: 'filter', operator: 'Filter', estimatedRows: 100, details: { expression: 'n.age > 25' },
                children: [{ id: 'expand', operator: 'Expand(All)', estimatedRows: 500,
                    children: [{ id: 'scan', operator: 'NodeByLabelScan', estimatedRows: 1000, details: { label: 'Person' } }]
                }]
            }]
        };
    }

    public dispose(): void {
        QueryPlanPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }
}

export function registerQueryPlanPanel(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('geode.showQueryPlan', () => {
            QueryPlanPanel.createOrShow(context.extensionUri);
        })
    );
}
