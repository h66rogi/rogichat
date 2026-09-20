package chat.rogi.rogichat.core.network

import chat.rogi.rogichat.core.media.MediaRequest
import chat.rogi.rogichat.core.messageactions.ActionRequest

/** Feature helpers cannot turn the authenticated client into an arbitrary URL/method proxy. */
internal object FeatureRoutes {
    private const val ID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    fun media(request: MediaRequest) {
        val expected = when {
            request.path == "media/upload-intents" -> "POST" to 201
            request.path.matches(Regex("media/upload-intents/$ID/content")) -> "POST" to 202
            request.path.matches(Regex("media/upload-intents/$ID")) -> "GET" to 200
            request.path.matches(Regex("media/assets/$ID/access")) -> "POST" to 200
            request.path.matches(Regex("rooms/$ID/stickers(?:\\?after=$ID)?")) -> "GET" to 200
            request.path == "me/profile" -> "PATCH" to 200
            request.path == "me/provider-avatar/access" || request.path.matches(Regex("rooms/$ID/actors/$ID/provider-avatar/access")) -> "POST" to 200
            else -> throw IllegalArgumentException("unsupported_media_route")
        }
        require(expected == (request.method to request.expectedStatus))
        require((request.upload != null) == request.path.endsWith("/content"))
        if (request.path.endsWith("/provider-avatar/access")) require(request.jsonBody == null && request.upload == null)
    }
    fun action(request: ActionRequest) {
        if (request.path == "blocked-rooms") {
            require(request.method == "GET" && request.body == null && request.successStatus == 200)
            require(request.query.isEmpty() || request.query.keys == setOf("cursor") && request.query.getValue("cursor").let { it.length in 1..2200 && it.matches(Regex("[A-Za-z0-9_.-]+")) })
            return
        }
        require(request.query.isEmpty() || request.method == "GET" && request.path.matches(Regex("rooms/$ID/blocks")) &&
            request.query.keys == setOf("after") && request.query.getValue("after").matches(Regex(ID)))
        val route = request.method + " " + request.path
        val valid = listOf("POST rooms/$ID/messages/$ID/delete", "POST rooms/$ID/messages/$ID/publications",
            "GET rooms/$ID/publications/$ID", "GET rooms/$ID/messages/$ID/reactions", "PUT rooms/$ID/messages/$ID/reactions/me",
            "DELETE rooms/$ID/messages/$ID/reactions/me", "POST rooms/$ID/messages/$ID/reports",
            "PUT rooms/$ID/blocks/$ID", "DELETE rooms/$ID/blocks/$ID", "GET rooms/$ID/blocks",
            "GET report-receipts/$ID", "GET rooms/$ID/read-state", "PUT rooms/$ID/read-state")
        require(valid.any { route.matches(Regex(it)) })
    }
}
