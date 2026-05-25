import { ServerBootstrap } from '../../webview/html'

export function healthPingHandler(deps: { serverInfo: ServerBootstrap }) {
    return async function (_payload: unknown) {
        return {
            host: deps.serverInfo.host,
            port: deps.serverInfo.port,
            timestamp: Date.now(),
        }
    }
}
