package chat.rogi.rogichat.feature.settings

import java.text.Normalizer

enum class ProfilePhase(val label: String) { READY("편집"), LOADING("불러오는 중"), FAILED("불러오기 오류"), UNAVAILABLE("미연동") }

// Presentation-only input. A successful service save must eventually replace the baseline explicitly.
data class ProfileEditor(val baseline: String, val draft: String = baseline, val phase: ProfilePhase = ProfilePhase.READY) {
    val normalized: String get() = Normalizer.normalize(draft, Normalizer.Form.NFC).trim { it.code in jsWhitespace }
    val length: Int get() = normalized.codePointCount(0, normalized.length)
    val error: String? get() = when {
        length == 0 -> "표시 이름을 입력해 주세요."
        length > 40 -> "표시 이름은 40자까지 입력할 수 있어요."
        normalized.codePoints().anyMatch { Character.getType(it) in listOf(Character.CONTROL.toInt(), Character.FORMAT.toInt()) } -> "제어 문자나 보이지 않는 형식 문자는 사용할 수 없어요."
        else -> null
    }
    val changed: Boolean get() = draft != baseline
    fun edit(value: String): ProfileEditor {
        if (phase != ProfilePhase.READY) return this
        // Bound paste input without splitting a supplementary Unicode scalar.
        val end = value.offsetByCodePoints(0, minOf(200, value.codePointCount(0, value.length)))
        return copy(draft = value.substring(0, end))
    }
    fun discard() = copy(draft = baseline)
    companion object {
        // ECMAScript trim, matching the server nickname normalizer; not Character.isWhitespace.
        private val jsWhitespace = setOf(9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279) + (8192..8202)
    }
}
