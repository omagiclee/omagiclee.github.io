import AppKit
import Photos

let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
let responsePath = argument("--response")

func finish(_ value: [String: Any], code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    if let path = responsePath { try? data.write(to: URL(fileURLWithPath: path), options: .atomic) }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(code)
}
func fail(_ message: String) -> Never { finish(["ok": false, "error": message], code: 1) }
let input = argument("--request").flatMap {try? Data(contentsOf: URL(fileURLWithPath: $0))} ?? FileHandle.standardInput.readDataToEndOfFile()
guard let request = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      let action = request["action"] as? String else { fail("删除请求无效。") }
let application = NSApplication.shared
application.setActivationPolicy(.accessory)

func runAuthorized() {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    guard status == .authorized || status == .limited else { fail("请在系统设置 → 隐私与安全性 → 照片中，允许“本地相册”访问照片。") }
    if action == "authorize" { finish(["ok": true, "authorization": status.rawValue]) }
    let batch = action == "delete-batch"
    let selected: [[String: Any]]
    if batch {
        guard let items = request["items"] as? [[String: Any]], (1...500).contains(items.count),
              items.allSatisfy({ $0["id"] is String }),
              Set(items.compactMap({ $0["id"] as? String })).count == items.count else { fail("批量删除列表无效。") }
        selected = items
    } else { selected = [request] }
    var verified: [PHAsset] = []
    var identifiers = Set<String>()
    for item in selected {
        guard let uuid = item["uuid"] as? String, UUID(uuidString: uuid) != nil,
              let filename = item["filename"] as? String,
              identifiers.insert(uuid.uppercased()).inserted else { fail("缺少唯一可验证的系统照片标识。") }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: [uuid + "/L0/001"], options: nil)
        guard assets.count == 1, let asset = assets.firstObject,
              asset.localIdentifier.split(separator: "/").first?.uppercased() == uuid.uppercased() else { fail("系统图库中没有找到这张照片，请刷新相册。") }
        let resources = PHAssetResource.assetResources(for: asset)
        guard resources.contains(where: {$0.originalFilename.caseInsensitiveCompare(filename) == .orderedSame}) else { fail("系统照片文件名与当前索引不一致，请刷新相册后再删除。") }
        if action == "inspect" { finish(["ok": true, "matched": true, "canDelete": asset.canPerform(.delete)]) }
        guard (action == "delete" || batch), asset.canPerform(.delete) else { fail("系统不允许删除这张照片。") }
        verified.append(asset)
    }
    PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.deleteAssets(verified as NSArray)
    }) { success, error in
        if success {
            if batch { finish(["ok": true, "deleted_ids": selected.compactMap({ $0["id"] as? String }), "failed": [], "destination": "recently_deleted"]) }
            finish(["ok": true, "deleted": true, "destination": "recently_deleted"])
        }
        fail(error?.localizedDescription ?? "系统没有完成删除，照片仍保留。")
    }
}
DispatchQueue.main.async {
    if action == "status" { finish(["ok": true, "authorization": PHPhotoLibrary.authorizationStatus(for: .readWrite).rawValue]) }
    if action == "trash" || action == "trash-batch" {
        let batch = action == "trash-batch"
        let selected: [[String: Any]]
        if batch {
            guard let items = request["items"] as? [[String: Any]], (1...500).contains(items.count),
                  items.allSatisfy({ $0["id"] is String }),
                  Set(items.compactMap({ $0["id"] as? String })).count == items.count else { fail("批量删除列表无效。") }
            selected = items
        } else { selected = [request] }
        var paths = Set<String>()
        // Validate every selected file before moving the first one.
        for item in selected {
            guard let path = item["path"] as? String, let expectedSize = item["size"] as? NSNumber,
                  let expectedTime = item["mtime"] as? Double,
                  paths.insert(path).inserted else { fail("文件删除请求无效。") }
            do {
                let attributes = try FileManager.default.attributesOfItem(atPath: path)
                guard attributes[.type] as? FileAttributeType == .typeRegular,
                      (attributes[.size] as? NSNumber) == expectedSize,
                      let changed = attributes[.modificationDate] as? Date,
                      abs(changed.timeIntervalSince1970 - expectedTime) < 0.001 else { fail("文件已经变化，请刷新后重试。") }
            } catch { fail("文件不可用：\(error.localizedDescription)") }
        }
        var deleted: [String] = []
        var failed: [[String: String]] = []
        for item in selected {
            let path = item["path"] as! String
            do {
                // Recheck immediately before each move; other processes can change files.
                let attributes = try FileManager.default.attributesOfItem(atPath: path)
                guard attributes[.type] as? FileAttributeType == .typeRegular,
                      (attributes[.size] as? NSNumber) == item["size"] as? NSNumber,
                      let changed = attributes[.modificationDate] as? Date,
                      let expectedTime = item["mtime"] as? Double,
                      abs(changed.timeIntervalSince1970 - expectedTime) < 0.001 else {
                    throw NSError(domain: "LocalPhotos", code: 1, userInfo: [NSLocalizedDescriptionKey: "文件已经变化，请刷新后重试。"])
                }
                var target: NSURL?
                try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: &target)
                if !batch { finish(["ok": true, "deleted": true, "destination": "trash"]) }
                deleted.append(item["id"] as! String)
            } catch {
                let message = "移到废纸篓失败：\(error.localizedDescription)"
                if !batch { fail(message) }
                failed.append(["id": item["id"] as! String, "error": message])
            }
        }
        finish(["ok": true, "deleted_ids": deleted, "failed": failed, "destination": "trash"])
    }
    guard ["authorize", "inspect", "delete", "delete-batch"].contains(action) else { fail("不支持的操作。") }
    if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined {
        application.activate(ignoringOtherApps: true)
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in DispatchQueue.main.async { runAuthorized() } }
    } else { runAuthorized() }
}
application.run()
