import Foundation
import RealityKit

@main
struct Reconstruct {
    static func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let line = String(data: data, encoding: .utf8) else { return }
        print(line)
        fflush(stdout)
    }

    static func main() async {
        if CommandLine.arguments.contains("--check") {
            emit(["supported": PhotogrammetrySession.isSupported])
            return
        }
        guard CommandLine.arguments.count == 3 else {
            emit(["error": "Usage: reconstruct images-directory output-directory"])
            exit(2)
        }
        guard PhotogrammetrySession.isSupported else {
            emit(["error": "Photogrammetry is not supported by this Mac."])
            exit(3)
        }
        do {
            var configuration = PhotogrammetrySession.Configuration()
            configuration.sampleOrdering = .sequential
            configuration.featureSensitivity = .high
            let session = try PhotogrammetrySession(
                input: URL(fileURLWithPath: CommandLine.arguments[1]),
                configuration: configuration
            )
            let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let request = PhotogrammetrySession.Request.modelFile(url: directory, detail: .reduced)
            try session.process(requests: [request])
            for try await output in session.outputs {
                switch output {
                case .requestProgress(_, let fraction):
                    emit(["progress": fraction])
                case .requestComplete(_, _):
                    emit(["complete": true])
                case .requestError(_, let error):
                    emit(["error": String(describing: error)])
                    exit(4)
                case .invalidSample(let id, let reason):
                    emit(["warning": "Invalid sample \(id): \(reason)"])
                case .skippedSample(let id):
                    emit(["warning": "Skipped sample \(id)"])
                case .processingComplete:
                    return
                default: break
                }
            }
        } catch {
            emit(["error": String(describing: error)])
            exit(1)
        }
    }
}
