import Foundation
import Speech

struct SpeechResponse: Codable {
    let ok: Bool
    let text: String?
    let code: String?
    let error: String?
    let onDevice: Bool
}

func emit(_ response: SpeechResponse, exitCode: Int32 = 0) -> Never {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(response), let json = String(data: data, encoding: .utf8) {
        let outputData = Data((json + "\n").utf8)
        if let index = CommandLine.arguments.firstIndex(of: "--output"), index + 1 < CommandLine.arguments.count {
            try? outputData.write(to: URL(fileURLWithPath: CommandLine.arguments[index + 1]), options: .atomic)
        } else {
            FileHandle.standardOutput.write(outputData)
        }
    }
    fflush(stdout)
    exit(exitCode)
}

func argument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else {
        return nil
    }
    return CommandLine.arguments[index + 1]
}

guard let filePath = argument("--file"), !filePath.isEmpty else {
    emit(SpeechResponse(ok: false, text: nil, code: "missing_file", error: "缺少待识别的本地音频文件。", onDevice: true), exitCode: 2)
}

let language = argument("--language") ?? "zh-CN"
let audioURL = URL(fileURLWithPath: filePath)
guard FileManager.default.fileExists(atPath: audioURL.path) else {
    emit(SpeechResponse(ok: false, text: nil, code: "file_not_found", error: "本地录音文件不存在。", onDevice: true), exitCode: 2)
}

func transcribe() {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)) else {
        emit(SpeechResponse(ok: false, text: nil, code: "language_unavailable", error: "当前系统未安装中文语音识别语言。", onDevice: true), exitCode: 3)
    }
    guard recognizer.isAvailable else {
        emit(SpeechResponse(ok: false, text: nil, code: "recognizer_unavailable", error: "系统语音识别当前不可用。", onDevice: true), exitCode: 3)
    }
    if #available(macOS 10.15, *), !recognizer.supportsOnDeviceRecognition {
        emit(SpeechResponse(ok: false, text: nil, code: "on_device_unavailable", error: "当前 Mac 尚未安装中文设备端听写语言，请在系统设置的键盘与听写中下载中文语言。", onDevice: true), exitCode: 3)
    }

    let request = SFSpeechURLRecognitionRequest(url: audioURL)
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    if #available(macOS 10.15, *) {
        request.requiresOnDeviceRecognition = true
    }

    var completed = false
    var task: SFSpeechRecognitionTask?
    func finish(_ response: SpeechResponse, exitCode: Int32 = 0) {
        guard !completed else { return }
        completed = true
        task?.cancel()
        emit(response, exitCode: exitCode)
    }

    task = recognizer.recognitionTask(with: request) { result, error in
        if let result = result, result.isFinal {
            let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty {
                finish(SpeechResponse(ok: false, text: nil, code: "no_speech", error: "未检测到清晰语音。", onDevice: true), exitCode: 4)
            } else {
                finish(SpeechResponse(ok: true, text: text, code: nil, error: nil, onDevice: true))
            }
            return
        }
        if let error = error {
            finish(SpeechResponse(ok: false, text: nil, code: "recognition_failed", error: "本地语音识别失败：\(error.localizedDescription)", onDevice: true), exitCode: 4)
        }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 90) {
        finish(SpeechResponse(ok: false, text: nil, code: "timeout", error: "本地语音识别超时。", onDevice: true), exitCode: 5)
    }
}

func continueAfterAuthorization(_ status: SFSpeechRecognizerAuthorizationStatus) {
    switch status {
    case .authorized:
        transcribe()
    case .denied, .restricted:
        emit(SpeechResponse(ok: false, text: nil, code: "speech_permission_denied", error: "语音识别权限被拒绝，请在系统设置的隐私与安全性中允许WodeAppX使用语音识别。", onDevice: true), exitCode: 6)
    case .notDetermined:
        emit(SpeechResponse(ok: false, text: nil, code: "speech_permission_pending", error: "语音识别授权尚未完成，请重试。", onDevice: true), exitCode: 6)
    @unknown default:
        emit(SpeechResponse(ok: false, text: nil, code: "speech_permission_unknown", error: "无法确认系统语音识别权限。", onDevice: true), exitCode: 6)
    }
}

let authorization = SFSpeechRecognizer.authorizationStatus()
if authorization == .notDetermined {
    SFSpeechRecognizer.requestAuthorization { status in
        DispatchQueue.main.async {
            continueAfterAuthorization(status)
        }
    }
} else {
    DispatchQueue.main.async {
        continueAfterAuthorization(authorization)
    }
}

RunLoop.main.run()
