import http from "http"
import net from "net"
import { randomUUID } from "node:crypto"
import * as timers from "node:timers/promises"
import { WebSocketServer, WebSocket } from "ws"

const [command = "", whatToShare = "", whereToShare = ""] = process.argv.slice(2)

class EArgs extends Error {}

try {
	if (command === "client" && whatToShare && +whereToShare) {
		startClient(whatToShare, +whereToShare)
	} else if (command === "server" && +whatToShare && whereToShare) {
		startServer(+whatToShare, whereToShare)
	} else {
		throw new EArgs()
	}
} catch (e) {
	if (e instanceof EArgs) {
		console.error("Usage: tcp_http_proxy server <tcpport> <url>")
		console.error("Usage: tcp_http_proxy client http://localhost:<httpport>/<path> <tcpport>")
		process.exit(1)
	} else {
		throw e
	}
}

//
//
function startClient(connection: string, tcpPort: number) {
	const url = new URL(connection)

	if (url.protocol && url.protocol !== "http:") {
		throw new EArgs()
	}
	if (url.hostname && url.hostname !== "localhost") {
		throw new EArgs()
	}

	if (!url.pathname || url.pathname === "/") {
		url.pathname =
			"/" +
			Buffer.from(randomUUID().replace(/-/g, ""), "hex")
				.toString("base64")
				.replaceAll("=", "")
				.replaceAll("/", "")
				.replaceAll("+", "")
				.slice(-18)
	}

	let counter = 0
	const path = url.pathname
	const httpPort = +(url.port ?? 80)

	console.log("Client: forwarding", tcpPort, "to", url.toString())

	const httpServer = new http.Server()
	const wss = new WebSocketServer({ server: httpServer, path })

	wss.on("connection", ws => {
		console.log("WebSocket connection established")

		if (counter > 0) {
			ws.close()
			return
		}

		const sockets = new Map<number, net.Socket>()
		const tcpServer = new net.Server(async socket => {
			do {
				counter = (counter % 2_000_000_000) + 1
			} while (sockets.has(counter))
			const id = counter
			sockets.set(id, socket)
			try {
				for await (const data of socket) {
					ws.send(encode(id, data))
				}
			} catch {
			} finally {
				ws.send(encode(id, null))
			}
		})

		tcpServer.listen(tcpPort)

		ws.on("message", (data: Uint8Array) => {
			try {
				const [id, socketData] = decode(data)
				if (!id) {
					// ignore
				} else if (socketData) {
					sockets.get(id)?.write(Buffer.from(socketData))
				} else {
					sockets.get(id)?.end()
				}
			} catch (e) {
				console.error("Error parsing message:", e)
			}
		})

		ws.on("close", () => {
			for (const socket of sockets.values()) {
				socket.destroySoon()
			}
			tcpServer.close()
			counter = 0
		})
	})

	httpServer.listen(httpPort)
}

//
//
async function startServer(port: number, url: string) {
	console.log("Server: forwarding", url, "to", port)

	while (true) {
		try {
			const ws = new WebSocket(url.replace(/^http/, "ws"))

			await new Promise<void>((resolve, reject) => {
				ws.on("open", () => {
					console.log("Connected to proxy")
					resolve()
				})
				ws.on("error", reject)
			})

			const sockets = new Map<number, net.Socket>()

			ws.on("message", (data: Uint8Array) => {
				try {
					const [id, socketData] = decode(data)
					if (!id) {
						// ignore
					} else if (socketData) {
						if (!sockets.has(id)) {
							const socket = net.connect(port, "localhost", async () => {
								console.log("Starting", id)
								try {
									for await (const tcpData of socket) {
										ws.send(encode(id, tcpData))
									}
								} catch {
									console.log("Error reading socket", id)
								} finally {
									ws.send(encode(id, null))
								}
							})
							sockets.set(id, socket)
						}
						sockets.get(id)?.write(Buffer.from(socketData))
					} else {
						sockets.get(id)?.end()
					}
				} catch (e) {
					console.error("Error parsing message:", e)
				}
			})

			await new Promise<void>(resolve => {
				ws.on("close", () => {
					for (const socket of sockets.values()) {
						socket.destroySoon()
					}
					resolve()
				})
			})
		} catch (e) {
			console.error("Connection failed:", e)
		}

		await timers.setTimeout(1000)
	}
}

function encode(id: number, socketData: Uint8Array | null) {
	const prefix = Buffer.from(new Uint32Array([id]).buffer)
	return socketData ? Buffer.concat([prefix, socketData]) : prefix
}

function decode(data: Uint8Array): [number, Uint8Array | null] {
	const buffer = Buffer.from(data)

	if (buffer.length < 4) {
		return [0, null]
	}

	const id = buffer.readUInt32LE(0)

	const socketData = buffer.length > 4 ? buffer.subarray(4) : null

	return [id, socketData]
}
