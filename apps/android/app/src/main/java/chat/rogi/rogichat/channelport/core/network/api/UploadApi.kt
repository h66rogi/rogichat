package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.upload.UploadImageResponse
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.setBody
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType

class UploadApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun uploadImage(
        fileName: String,
        contentType: String,
        imageBytes: ByteArray,
    ): UploadImageResponse {
        require(imageBytes.size <= 10 * 1024 * 1024)
        require(fileName.matches(Regex("[A-Za-z0-9_.-]+")))
        require(contentType in setOf("image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"))
        return apiClient.post<UploadImageResponse>("/v1/upload/image") {
            val form = MultiPartFormDataContent(formData {
                append("image", imageBytes, Headers.build {
                    append(HttpHeaders.ContentType, contentType)
                    append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                })
            })
            contentType(form.contentType)
            setBody(form)
        }
    }
}
