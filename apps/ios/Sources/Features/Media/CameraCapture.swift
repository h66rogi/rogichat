import SwiftUI
import UIKit

struct CameraCapture: UIViewControllerRepresentable {
    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    let scope: any MediaScope
    let onSelected: @MainActor (MediaFile) async throws -> Void
    let onCancel: @MainActor () -> Void
    let onFailure: @MainActor () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    @MainActor final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraCapture
        init(parent: CameraCapture) { self.parent = parent }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.onCancel() }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let image = info[.originalImage] as? UIImage else { parent.onFailure(); return }
            Task { @MainActor in
                var file: MediaFile?
                do {
                    try parent.scope.check()
                    guard let data = [0.85, 0.65, 0.45].lazy.compactMap({ image.jpegData(compressionQuality: $0) })
                        .first(where: { Int64($0.count) <= MediaKind.photo.maximumBytes }) else { throw MediaError.invalid }
                    let url = FileManager.default.temporaryDirectory
                        .appendingPathComponent("camera-" + UUID().uuidString).appendingPathExtension("jpg")
                    try data.write(to: url, options: [.atomic, .completeFileProtection])
                    do {
                        file = try MediaFile(url: url, kind: .photo, contentType: "image/jpeg")
                    } catch { try? FileManager.default.removeItem(at: url); throw error }
                    if let file { try await parent.onSelected(file) }
                } catch {
                    file?.remove()
                    parent.onFailure()
                }
            }
        }
    }
}
