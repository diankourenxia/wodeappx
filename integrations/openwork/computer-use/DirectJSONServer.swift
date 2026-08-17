import AppKit
import Foundation

actor DirectJSONServer {
    private let tools = MCPServer()

    func run() async {
        log("Computer Use direct server starting")
        while let line = readLine(strippingNewline: true) {
            guard !line.isEmpty else { continue }
            let response = await handle(line: line)
            writeLine(response)
        }
    }

    private func handle(line: String) async -> [String: Any] {
        guard let data = line.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ["ok": false, "error": "Invalid JSON line."]
        }

        var response: [String: Any] = [:]
        if let id = request["id"] {
            response["id"] = id
        }

        let tool = request["tool"] as? String ?? request["name"] as? String ?? ""
        let args = request["args"] as? [String: Any] ?? request["arguments"] as? [String: Any] ?? [:]

        if tool == "tools/list" || tool == "list_tools" {
            response["ok"] = true
            response["tools"] = await tools.toolSchemas()
            return response
        }

        guard !tool.isEmpty else {
            response["ok"] = false
            response["error"] = "Missing tool name."
            return response
        }

        let content = await tools.executeTool(name: tool, args: args)
        response["ok"] = !contentContainsFailure(content)
        response["tool"] = tool
        response["content"] = content
        return response
    }

    private func contentContainsFailure(_ content: [[String: Any]]) -> Bool {
        for item in content {
            guard item["type"] as? String == "text",
                  let text = item["text"] as? String,
                  let data = text.data(using: .utf8),
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                continue
            }
            if payload["ok"] as? Bool == false { return true }
        }
        return false
    }

    private func writeLine(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else {
            print("{\"ok\":false,\"error\":\"Failed to serialize response.\"}")
            return
        }
        print(text)
    }

    private func log(_ message: String) {
        fputs("[ComputerUseDirect] \(message)\n", stderr)
    }
}
